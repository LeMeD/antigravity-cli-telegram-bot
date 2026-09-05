/**
 * Orchestrator script for GitHub Actions self-hosted runner.
 * Directly invokes Antigravity CLI (`agy`) with full repository context,
 * persistent memory, and native tools to process mobile specification feedback.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync, spawn } from 'node:child_process';

// 1. Validate environment variables
const {
  EVENT_PATH,
  GITHUB_TOKEN,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
  TELEGRAM_THREAD_ID,
  AGY_BIN = '/home/med/.local/bin/agy',
} = process.env;

if (!EVENT_PATH || !fs.existsSync(EVENT_PATH)) {
  console.error('Event file not found (missing EVENT_PATH).');
  process.exit(1);
}

const event = JSON.parse(fs.readFileSync(EVENT_PATH, 'utf-8'));

// 2. Security guards
// A. Private repositories only
if (!event.repository?.private) {
  console.log('Security: this workflow is strictly reserved for private personal repositories. Skipping execution.');
  process.exit(0);
}

// B. Presence of tracked label ('spec', 'spec-in-progress', 'ready-for-dev', 'idea', 'enhancement')
const TRACKED_LABELS = ['spec', 'spec-in-progress', 'ready-for-dev', 'idea', 'enhancement'];
const isTrackedIssue = event.issue?.labels?.some((l) => TRACKED_LABELS.includes(l.name));
if (!isTrackedIssue) {
  console.log(`Issue does not have a tracked label (${TRACKED_LABELS.join(', ')}). Skipping execution.`);
  process.exit(0);
}

// C. Author must be repository owner
const isOwner = event.comment?.user?.login === event.repository?.owner?.login;
if (!isOwner) {
  console.log('Comment from third party (non-owner). Skipping execution.');
  process.exit(0);
}

// D. Loop prevention: ignore bots
if (event.comment?.user?.type === 'Bot' || event.comment?.performed_via_github_app) {
  console.log('Comment from a bot. Skipping execution to prevent infinite loops.');
  process.exit(0);
}

const repoFullName = event.repository.full_name;
const defaultBranch = event.repository?.default_branch || 'main';
const issueNumber = event.issue.number;
const issueTitle = event.issue.title || '';
const issueBody = (event.issue.body || '').trim();
const commentBody = (event.comment.body || '').trim();
const issueUrl = event.issue.html_url;

// Utility functions
function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function sendTelegramMessage(htmlContent) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log('Telegram not configured, skipping notification.');
    return;
  }
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  try {
    const payload = {
      chat_id: TELEGRAM_CHAT_ID,
      text: htmlContent,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    };
    if (TELEGRAM_THREAD_ID) {
      payload.message_thread_id = parseInt(TELEGRAM_THREAD_ID, 10);
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error('Error sending Telegram notification:', err);
    }
  } catch (err) {
    console.error('Exception sending Telegram notification:', err);
  }
}

async function postIssueComment(body) {
  if (!GITHUB_TOKEN) return;
  const url = `https://api.github.com/repos/${repoFullName}/issues/${issueNumber}/comments`;
  await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Spec-Automation-Agent',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ body }),
  });
}

async function closeIssue(reason = 'completed') {
  if (!GITHUB_TOKEN) return;
  const url = `https://api.github.com/repos/${repoFullName}/issues/${issueNumber}`;
  const payload = { state: 'closed' };
  if (reason) payload.state_reason = reason;
  await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Spec-Automation-Agent',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

// 3. Fast deterministic case: Abandonment
const isAbandonment =
  /^(abandon|abandonné|abandonne|annulé|annule|rejeté|rejeter|refusé|refuser|sans suite|ne pas faire|stop)\b/i.test(commentBody) ||
  /^\/abandon\b/i.test(commentBody) ||
  /^\/cancel\b/i.test(commentBody);

if (isAbandonment) {
  console.log("Abandonment detected. Closing issue and updating backlog.");
  const today = new Date().toISOString().slice(0, 10);
  const filesToCommit = [];

  // Strike out in BACKLOG.md if present
  let backlogFile = null;
  if (fs.existsSync('BACKLOG.md')) backlogFile = 'BACKLOG.md';
  else if (fs.existsSync('TODO.md')) backlogFile = 'TODO.md';

  if (backlogFile) {
    let backlog = fs.readFileSync(backlogFile, 'utf-8');
    const issueLinkRegex = new RegExp(`- \\\\[([ x~])\\\\] (.*?\\\\[Issue #${issueNumber}\\\\].*)`, 'g');
    if (issueLinkRegex.test(backlog)) {
      backlog = backlog.replace(issueLinkRegex, (match, check, rest) => {
        const cleanRest = rest.replace(/^~~(.*)~~/, '$1');
        return `- [ ] ~~${cleanRest}~~ *(Piste abandonnée suite à arbitrage sur [Issue #${issueNumber}])*`;
      });
      fs.writeFileSync(backlogFile, backlog, 'utf-8');
      filesToCommit.push(backlogFile);
    }
  }

  // Git commit & push if changes exist
  if (filesToCommit.length > 0) {
    execSync('git config user.name "github-actions[bot]"');
    execSync('git config user.email "github-actions[bot]@users.noreply.github.com"');
    execSync(`git add ${filesToCommit.map((f) => `"${f}"`).join(' ')}`);

    let hasStagedChanges = false;
    try {
      execSync('git diff --staged --quiet');
    } catch {
      hasStagedChanges = true;
    }

    if (hasStagedChanges) {
      execSync(`git commit -m "docs(backlog): abandon track upon confirmation on issue #${issueNumber}"`);
      execSync(`git push origin ${defaultBranch}`);
    }
  }

  // Set abandoned label and remove active labels
  try {
    const labelsUrl = `https://api.github.com/repos/${repoFullName}/issues/${issueNumber}/labels`;
    await fetch(labelsUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Spec-Automation-Agent',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ labels: ['abandoned'] }),
    });
  } catch (err) {
    console.warn('Could not add abandoned label:', err.message);
  }

  await postIssueComment(
    `❌ **Piste ou spécification abandonnée et clôturée.**\n\nCette fonctionnalité ne sera pas implémentée conformément à votre arbitrage.`
  );

  await closeIssue('not_planned');

  await sendTelegramMessage(
    `❌ <b>Piste / Spécification abandonnée et clôturée</b>\n\n` +
      `📌 <b>Issue :</b> <a href="${issueUrl}">#${issueNumber} ${escapeHtml(issueTitle)}</a>\n\n` +
      `<i>Cette fonctionnalité a été classée sans suite conformément à votre arbitrage.</i>`
  );

  console.log('Closure by abandonment completed.');
  process.exit(0);
}

// 4. Retrieve comments history for complete conversational context
let formattedComments = '*(Aucun commentaire antérieur)*';
try {
  const commentsUrl = `https://api.github.com/repos/${repoFullName}/issues/${issueNumber}/comments?per_page=50`;
  const commentsRes = await fetch(commentsUrl, {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Spec-Automation-Agent',
    },
  });
  if (commentsRes.ok) {
    const commentsData = await commentsRes.json();
    if (Array.isArray(commentsData) && commentsData.length > 0) {
      formattedComments = commentsData
        .map((c) => {
          const author = c.user?.login || 'inconnu';
          const isBot = c.user?.type === 'Bot' || c.performed_via_github_app;
          const label = isBot ? `🤖 ${author}` : `👤 ${author}`;
          return `--- Commentaire de ${label} (${c.created_at}) ---\n${c.body}`;
        })
        .join('\n\n');
    }
  }
} catch (err) {
  console.warn('Could not fetch previous comments history:', err.message);
}

// 5. Notify Telegram that Antigravity is processing the comment
await sendTelegramMessage(
  `⏳ <b>Antigravity prend en charge votre retour sur l'issue #${issueNumber}</b>\n\n` +
    `📌 <b>Issue :</b> <a href="${issueUrl}">#${issueNumber} ${escapeHtml(issueTitle)}</a>\n` +
    `💬 <b>Votre message :</b>\n<i>${escapeHtml(commentBody.slice(0, 300))}${commentBody.length > 300 ? '...' : ''}</i>\n\n` +
    `🔍 <i>Analyse de la codebase et réflexion d'ingénierie en cours...</i>`
);

// 6. Build the prompt for Antigravity CLI
const workspaceDir = process.cwd();

const agyPrompt = `
Tu es Antigravity, l'assistant d'ingénierie logicielle officiel du projet et l'architecte pair programming de Mehdi.
Tu es sollicité automatiquement en tâche de fond pour analyser et traiter son retour sur l'issue GitHub #${issueNumber} du dépôt '${repoFullName}'.

### Contexte de l'issue #${issueNumber}
- Titre : ${issueTitle}
- URL : ${issueUrl}
- Description initiale du besoin :
"""
${issueBody}
"""

### Historique des échanges sur l'issue
${formattedComments}

### Dernier commentaire de Mehdi à traiter
"""
${commentBody}
"""

### Directives d'exécution et de décision
Tu es dans l'environnement du projet (${workspaceDir}). Tu disposes de tous tes outils natifs (lecture de fichiers, grep, modification, exécution de commandes shell 'gh' et 'git', mémoire 'agy-memory-engine').

Analyse l'intention de Mehdi et exécute rigoureusement l'un des trois cas suivants :

---
#### CAS 1 : C'est une QUESTION TECHNIQUE, de faisabilité ou de clarification
(Exemples : "Comment gérer les quotas ?", "Pourquoi telle approche ?", "Est-ce qu'on peut utiliser l'API X ?")
1. Ne modifie PAS les documents de spécification existants par erreur.
2. Explore le code source réel du projet dans '${workspaceDir}' pour analyser l'architecture en place (ex. gestion des tokens, sessions, routeurs, APIs).
3. Rédige une réponse d'ingénieur détaillée, claire, bien structurée et étayée par le code réel.
4. Poste ta réponse directement sur l'issue GitHub :
   gh issue comment ${issueNumber} --body "<ta_reponse_en_markdown>"
5. Envoie la notification Telegram avec un résumé clair de ta réponse :
   curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \\
     -H "Content-Type: application/json" \\
     -d '{"chat_id": "${TELEGRAM_CHAT_ID}", "message_thread_id": ${TELEGRAM_THREAD_ID ? Number(TELEGRAM_THREAD_ID) : 'null'}, "parse_mode": "HTML", "text": "💬 <b>Réponse d'\''Antigravity sur l'\''issue #${issueNumber} (${escapeHtml(issueTitle)})</b>\\n\\n<resume_de_ta_reponse>\\n\\n👉 <a href=\\"${issueUrl}\\\">Consulter la réponse complète sur GitHub</a>"}'

---
#### CAS 2 : C'est une VALIDATION FINALE de la spécification
(Exemples : "OK", "Validé", "Approuvé", "C'est bon pour moi", "Prêt pour l'implémentation")
1. Rédige ou consolide le document de spécification formel dans 'docs/specs/<nom-feature>.md' en respectant le gabarit officiel (Contexte & Objectifs, Flux Mermaid, Modèle de données & Contrats, Sécurité & Résilience, UX & Notifications, Scénarios de tests, Plan d'implémentation).
2. Assure-toi que l'en-tête indique formellement :
   > **Statut :** Spécification validée (prête pour implémentation)
3. Mets à jour 'BACKLOG.md' pour actualiser la ligne correspondante au statut '[~]' (et non '[x]', le code n'étant pas encore développé/livré) et ajoute/actualise le lien Markdown vers 'docs/specs/<nom-feature>.md'.
4. Committe et pousse les modifications sur Git :
   git config user.name "github-actions[bot]"
   git config user.email "github-actions[bot]@users.noreply.github.com"
   git add docs/specs/ BACKLOG.md
   git commit -m "docs(specs): finalize and validate specification for issue #${issueNumber}"
   git push origin ${defaultBranch}
5. IMPORTANT — NE PAS FERMER L'ISSUE :
   L'issue doit rester OUVERTE en attente d'implémentation.
   Mets à jour les labels de l'issue pour refléter le passage en Stade 3 :
   gh issue edit ${issueNumber} --remove-label "spec,spec-in-progress,idea" --add-label "ready-for-dev"
6. Poste un commentaire confirmant la validation et précisant que l'issue reste ouverte :
   gh issue comment ${issueNumber} --body "✅ **Spécification validée et prête pour implémentation.**\\n\\nDocument consolidé : [\`docs/specs/<nom-feature>.md\`](${event.repository.html_url}/blob/${defaultBranch}/docs/specs/<nom-feature>.md)\\n\\nL'issue reste ouverte avec le libellé \`ready-for-dev\` en attente de réalisation technique."
7. Envoie une notification Telegram confirmant la validation et le passage de l'issue au statut 'ready-for-dev' (ouverte).

---
#### CAS 3 : C'est un RETOUR D'AMENDEMENT, une proposition ou la création d'une nouvelle spec
1. Rédige ou mets à jour le document 'docs/specs/<nom-feature>.md' avec le statut 'Spécification en cours de rédaction'.
2. Committe et pousse les modifications :
   git config user.name "github-actions[bot]"
   git config user.email "github-actions[bot]@users.noreply.github.com"
   git add docs/specs/<nom-feature>.md
   git commit -m "docs(specs): update specification based on issue #${issueNumber} feedback"
   git push origin ${defaultBranch}
3. Poste un commentaire autoportant sur l'issue (Mobile-First) avec :
   - 📌 Synthèse de la conception (état actuel en 3 à 5 points)
   - 🔄 Ce qui a changé suite à ce retour
   - ❓ Prochaine étape ou invitation à valider par "OK"
   - <details><summary>📄 Voir le document complet intégré</summary>\\n\\n<Markdown complet>\\n\\n</details>
4. Envoie une notification Telegram avec le résumé des changements apportés.

---
Important : Réponds toujours en français, n'utilise pas la casse à l'américaine dans les titres, et rédige les messages de commit en anglais.
`.trim();

// 7. Execute Antigravity CLI
console.log(`Starting Antigravity CLI via ${AGY_BIN}...`);

const agyProcess = spawn(
  AGY_BIN,
  ['--print', agyPrompt, '--output-format', 'stream-json', '--dangerously-skip-permissions'],
  {
    cwd: workspaceDir,
    env: {
      ...process.env,
      HOME: '/home/med',
      PATH: '/home/med/.local/bin:/home/med/.gemini/antigravity-cli/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      GITHUB_TOKEN,
      GH_TOKEN: GITHUB_TOKEN,
    },
    stdio: ['inherit', 'pipe', 'pipe'],
  }
);

let stdoutData = '';
let stderrData = '';

agyProcess.stdout.on('data', (chunk) => {
  const text = chunk.toString();
  stdoutData += text;
  process.stdout.write(text);
});

agyProcess.stderr.on('data', (chunk) => {
  const text = chunk.toString();
  stderrData += text;
  process.stderr.write(text);
});

agyProcess.on('close', async (code) => {
  console.log(`Antigravity CLI process completed with exit code ${code}.`);

  if (code !== 0) {
    console.error(`Antigravity error output: ${stderrData}`);
    await sendTelegramMessage(
      `⚠️ <b>Erreur lors du traitement Antigravity sur l'issue #${issueNumber}</b>\n\n` +
        `📌 <b>Issue :</b> <a href="${issueUrl}">#${issueNumber} ${escapeHtml(issueTitle)}</a>\n` +
        `❌ Code de sortie : <code>${code}</code>\n\n` +
        `<i>Veuillez vérifier les journaux d'exécution du runner.</i>`
    );
    process.exit(code || 1);
  }

  console.log('Antigravity execution completed successfully.');
  process.exit(0);
});
