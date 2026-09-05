/**
 * Script d'intégration continue et autonome des spécifications Markdown et du carnet de route.
 *
 * Déclenché par GitHub Actions sur l'événement `issue_comment`.
 * Analyse les arbitrages du propriétaire :
 * - Validation / Approbation -> fige la spec, met à jour BACKLOG.md, clôture l'issue (completed), notifie sur Telegram.
 * - Abandon / Rejet -> classe sans suite, barre la ligne dans BACKLOG.md, clôture l'issue (not_planned), notifie sur Telegram.
 * - Amendement / Retours -> met à jour le fichier Markdown via Gemini Flash, committe, commente l'issue et notifie sur Telegram.
 */

import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { GoogleGenAI, Type } from '@google/genai';

// 1. Contrôle des variables d'environnement requises
const {
  EVENT_PATH,
  GITHUB_TOKEN,
  GEMINI_API_KEY,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
  TELEGRAM_THREAD_ID,
  GEMINI_MODEL = 'gemini-3.5-flash-lite',
} = process.env;

if (!EVENT_PATH || !fs.existsSync(EVENT_PATH)) {
  console.error("Fichier d'événement introuvable (EVENT_PATH manquant).");
  process.exit(1);
}

const event = JSON.parse(fs.readFileSync(EVENT_PATH, 'utf-8'));

// 2. Garde-fous stricts de sécurité
// A. Dépôts privés uniquement
if (!event.repository?.private) {
  console.log('Sécurité : ce workflow est strictement réservé aux dépôts personnels privés. Exécution ignorée.');
  process.exit(0);
}

// B. Présence d'un label suivi ('spec' ou 'enhancement')
const isTrackedIssue = event.issue?.labels?.some(
  (l) => l.name === 'spec' || l.name === 'enhancement'
);
if (!isTrackedIssue) {
  console.log("L'issue ne comporte ni le label 'spec' ni 'enhancement'. Exécution ignorée.");
  process.exit(0);
}

// C. Auteur = propriétaire du dépôt
const isOwner = event.comment?.user?.login === event.repository?.owner?.login;
if (!isOwner) {
  console.log('Commentaire provenant d\'un tiers (non propriétaire). Exécution ignorée.');
  process.exit(0);
}

// D. Anti-boucle : ignorer les bots
if (event.comment?.user?.type === 'Bot' || event.comment?.performed_via_github_app) {
  console.log('Commentaire provenant d\'un bot. Exécution ignorée pour éviter les boucles infinies.');
  process.exit(0);
}

const repoFullName = event.repository.full_name;
const defaultBranch = event.repository?.default_branch || 'main';
const issueNumber = event.issue.number;
const commentBody = (event.comment.body || '').trim();

// Fonctions utilitaires Telegram et GitHub
function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function sendTelegramMessage(htmlContent) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log('Telegram non configuré, notification ignorée.');
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
      console.error('Erreur envoi Telegram :', err);
    }
  } catch (err) {
    console.error('Exception envoi Telegram :', err);
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

// 3. Résolution du fichier de spécification concerné (optionnel pour l'abandon)
function resolveSpecFile() {
  const issueBody = event.issue.body || '';
  // Recherche par balise explicite
  const tagMatch = issueBody.match(/<!--\s*SPEC_FILE:\s*([^\s>]+)\s*-->/);
  if (tagMatch && fs.existsSync(tagMatch[1].trim())) {
    return tagMatch[1].trim();
  }

  // Recherche par lien Markdown dans le corps
  const linkMatch = issueBody.match(/docs\/specs\/([a-zA-Z0-9_\-]+\.md)/);
  if (linkMatch && fs.existsSync(`docs/specs/${linkMatch[1]}`)) {
    return `docs/specs/${linkMatch[1]}`;
  }

  // Recherche dans docs/specs/
  if (fs.existsSync('docs/specs')) {
    const files = fs.readdirSync('docs/specs').filter((f) => f.endsWith('.md'));
    if (files.length === 1) return `docs/specs/${files[0]}`;

    // Correspondance par mots-clés du titre
    const titleWords = (event.issue.title || '').toLowerCase().split(/\W+/).filter((w) => w.length > 3);
    for (const f of files) {
      if (titleWords.some((w) => f.toLowerCase().includes(w))) {
        return `docs/specs/${f}`;
      }
    }
    if (files.length > 0) return `docs/specs/${files[0]}`;
  }

  return null;
}

const specFile = resolveSpecFile();
console.log(`Spécification ciblée : ${specFile || 'Aucune (issue de feuille de route pure)'}`);

// 4. Détection des intentions d'arbitrage
const isApproval =
  /^(ok|validé|valide|approuvé|approuve|conforme|terminé|clôturer|merci ok)\b/i.test(commentBody) ||
  /^\/valider\b/i.test(commentBody) ||
  /^\/ok\b/i.test(commentBody);

const isAbandonment =
  /^(abandon|abandonné|abandonne|annulé|annule|rejeté|rejeter|refusé|refuser|sans suite|ne pas faire|stop)\b/i.test(commentBody) ||
  /^\/abandon\b/i.test(commentBody) ||
  /^\/cancel\b/i.test(commentBody);

// 5. Cas 1 : Abandon / Rejet de la spécification ou de la piste de roadmap
if (isAbandonment) {
  console.log("Abandon détecté. Clôture de l'issue et mise à jour du carnet de route.");
  const today = new Date().toISOString().slice(0, 10);
  const filesToCommit = [];

  // Mise à jour du document Markdown de spec si présent
  if (specFile && fs.existsSync(specFile)) {
    let specContent = fs.readFileSync(specFile, 'utf-8');
    specContent = specContent.replace(
      /> \*\*Statut :\*\*.*/,
      `> **Statut :** Spécification abandonnée  \n> **Date d'abandon :** ${today}`
    );
    fs.writeFileSync(specFile, specContent, 'utf-8');
    filesToCommit.push(specFile);
  }

  // Mise à jour de BACKLOG.md ou TODO.md si présent
  let backlogFile = null;
  if (fs.existsSync('BACKLOG.md')) backlogFile = 'BACKLOG.md';
  else if (fs.existsSync('TODO.md')) backlogFile = 'TODO.md';

  if (backlogFile) {
    let backlog = fs.readFileSync(backlogFile, 'utf-8');
    const specBasename = specFile ? specFile.split('/').pop() : null;

    // 1. Recherche prioritaire par numéro d'issue : [Issue #X]
    const issueLinkRegex = new RegExp(`- \\[([ x~])\\] (.*?\\[Issue #${issueNumber}\\].*)`, 'g');
    if (issueLinkRegex.test(backlog)) {
      backlog = backlog.replace(issueLinkRegex, (match, check, rest) => {
        const cleanRest = rest.replace(/^~~(.*)~~/, '$1');
        return `- [ ] ~~${cleanRest}~~ *(Piste abandonnée suite à arbitrage sur [Issue #${issueNumber}])*`;
      });
    } else if (specBasename) {
      // 2. Recherche par nom de fichier de spec
      const specRegex = new RegExp(`- \\[([ x~])\\] (.*${specBasename}.*)`, 'g');
      backlog = backlog.replace(specRegex, (match, check, rest) => {
        const cleanRest = rest.replace(/^~~(.*)~~/, '$1');
        return `- [ ] ~~${cleanRest}~~ *(Piste abandonnée)*`;
      });
    }
    fs.writeFileSync(backlogFile, backlog, 'utf-8');
    filesToCommit.push(backlogFile);
  }

  // Git commit & push si des modifications ont eu lieu
  if (filesToCommit.length > 0) {
    execSync('git config user.name "github-actions[bot]"');
    execSync('git config user.email "github-actions[bot]@users.noreply.github.com"');
    execSync(`git add ${filesToCommit.map((f) => `"${f}"`).join(' ')}`);
    execSync(`git commit -m "docs(backlog): abandon de la piste suite à confirmation issue #${issueNumber}"`);
    execSync(`git push origin ${defaultBranch}`);
  }

  await postIssueComment(
    `❌ **Piste ou spécification abandonnée et clôturée.**\n\nCette fonctionnalité ne sera pas implémentée conformément à votre arbitrage.`
  );

  await closeIssue('not_planned');

  await sendTelegramMessage(
    `❌ <b>Piste / Spécification abandonnée et clôturée</b>\n\n` +
      (specFile ? `📄 <b>Document :</b> <code>${specFile}</code>\n` : '') +
      `📌 <b>Issue :</b> <a href="${event.issue.html_url}">#${issueNumber} ${escapeHtml(event.issue.title)}</a>\n\n` +
      `<i>Cette fonctionnalité a été classée sans suite conformément à votre arbitrage.</i>`
  );

  console.log('Clôture par abandon effectuée avec succès.');
  process.exit(0);
}

// 6. Cas 2 : Validation finale (l'utilisateur approuve la spécification)
if (isApproval) {
  if (!specFile) {
    await postIssueComment(
      `🎉 **Piste validée et clôturée !**\n\nCette piste a été approuvée.`
    );
    await closeIssue('completed');
    process.exit(0);
  }

  console.log("Approbation détectée. Clôture de l'issue et validation de la spécification.");
  const today = new Date().toISOString().slice(0, 10);
  let specContent = fs.readFileSync(specFile, 'utf-8');

  // Mise à jour du statut dans la spécification
  specContent = specContent.replace(
    /> \*\*Statut :\*\*.*/,
    `> **Statut :** Spécification validée (prête pour implémentation)  \n> **Date de validation :** ${today}`
  );
  fs.writeFileSync(specFile, specContent, 'utf-8');

  // Mise à jour de BACKLOG.md ou TODO.md si présent
  let backlogFile = null;
  if (fs.existsSync('BACKLOG.md')) backlogFile = 'BACKLOG.md';
  else if (fs.existsSync('TODO.md')) backlogFile = 'TODO.md';

  if (backlogFile) {
    let backlog = fs.readFileSync(backlogFile, 'utf-8');
    const specBasename = specFile.split('/').pop();
    // Passe les cases [ ] ou [~] associées à cette spec à [x]
    backlog = backlog.replace(
      new RegExp(`\\[[ ~]\\] (.*${specBasename}.*)`, 'g'),
      '[x] $1'
    );
    fs.writeFileSync(backlogFile, backlog, 'utf-8');
  }

  // Git commit & push
  execSync('git config user.name "github-actions[bot]"');
  execSync('git config user.email "github-actions[bot]@users.noreply.github.com"');
  execSync(`git add "${specFile}" ${backlogFile ? `"${backlogFile}"` : ''}`.trim());
  execSync(`git commit -m "docs(specs): validation de la spécification suite à confirmation issue #${issueNumber}"`);
  execSync(`git push origin ${defaultBranch}`);

  await postIssueComment(
    `🎉 **Spécification validée et clôturée !**\n\nLe document [\`${specFile}\`](${event.repository.html_url}/blob/${defaultBranch}/${specFile}) est désormais figé et prêt pour l'implémentation.`
  );

  await closeIssue('completed');

  await sendTelegramMessage(
    `🎉 <b>Spécification validée et clôturée</b>\n\n` +
      `📄 <b>Document :</b> <code>${specFile}</code>\n` +
      `📌 <b>Issue :</b> <a href="${event.issue.html_url}">#${issueNumber} ${escapeHtml(event.issue.title)}</a>\n\n` +
      `<i>La conception est figée, la fonctionnalité est prête pour le développement.</i>`
  );

  console.log('Clôture effectuée avec succès.');
  process.exit(0);
}

// 7. Cas 3 : Amendement / Arbitrage à intégrer via Gemini Flash
if (!specFile) {
  console.log('Issue de feuille de route sans fichier de spécification lié. Aucun document à amender.');
  await postIssueComment(
    `💡 **Aucun document de spécification lié.**\n\nCette issue de feuille de route ne comporte pas encore de document \`docs/specs/*.md\`. Vous pouvez demander à l'assistant d'en rédiger l'ébauche initiale pour démarrer la co-conception.`
  );
  process.exit(0);
}

console.log('Analyse du retour utilisateur via Gemini...');
if (!GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY manquant.');
  process.exit(1);
}

// Récupération de l'historique complet des commentaires de l'issue
let threadHistory = '';
if (GITHUB_TOKEN) {
  try {
    const commentsUrl = `https://api.github.com/repos/${repoFullName}/issues/${issueNumber}/comments?per_page=100`;
    const commentsRes = await fetch(commentsUrl, {
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Spec-Automation-Agent',
      },
    });
    if (commentsRes.ok) {
      const comments = await commentsRes.json();
      threadHistory = comments
        .map((c) => `[Auteur: ${c.user.login}, Date: ${c.created_at}]\n${c.body}`)
        .join('\n\n---\n\n');
    }
  } catch (err) {
    console.warn('Impossible de récupérer l\'historique des commentaires :', err);
  }
}

const currentSpec = fs.readFileSync(specFile, 'utf-8');

const prompt = `Tu es un architecte logiciel expert et rédacteur technique pour le projet ${repoFullName}.
Ton rôle est d'analyser le retour d'arbitrage de l'utilisateur (${event.repository.owner.login}) et de mettre à jour le document de spécification Markdown existant.

### Directives fondamentales :
1. Rédige STRICTEMENT en français.
2. N'utilise JAMAIS la casse à l'américaine (Title Case) dans les titres ; utilise la casse française (majuscule uniquement au début et aux noms propres).
3. Conserve rigoureusement toutes les sections, contrats d'interface et explications qui ne sont pas modifiés par le retour de l'utilisateur.
4. Respecte la syntaxe stricte des diagrammes Mermaid (ex: quotes autour des labels avec parenthèses).
5. Respecte les alertes Markdown GitHub (> [!NOTE], > [!IMPORTANT], etc.).
6. Ergonomie Mobile-First : l'utilisateur lit et arbitre depuis l'application GitHub Mobile sur smartphone. Il ne doit pas avoir à changer d'écran pour comprendre ou décider.
7. Si le retour utilisateur est clair et actionnable :
   - Intègre les modifications directement dans 'updated_spec' (renvoie le document Markdown COMPLET).
   - Mets 'clarification_needed' à false.
   - Fournis dans 'current_summary' une synthèse globale à jour en 3 à 5 puces Markdown des objectifs clés et des choix structurants de la conception.
   - Fournis dans 'change_summary' un résumé clair et synthétique en 2 à 4 puces des modifications apportées suite à ce dernier retour.
   - Fournis dans 'next_step' la prochaine étape attendue (question résiduelle, ou si la conception paraît complète, inviter l'utilisateur à répondre 'OK' pour valider).
8. Si le retour utilisateur est ambigu, pose une question ouverte sans trancher, ou s'il manque des informations critiques pour décider :
   - NE MODIFIE PAS le document.
   - Mets 'clarification_needed' à true.
   - Pose une question précise et bienveillante dans 'clarification_question' pour aider l'utilisateur à trancher.

### Spécification actuelle (${specFile}) :
${currentSpec}

### Historique des échanges sur l'issue :
${threadHistory || 'Aucun échange antérieur.'}

### Dernier retour utilisateur à intégrer :
${commentBody}
`;

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
const response = await ai.models.generateContent({
  model: GEMINI_MODEL,
  contents: prompt,
  config: {
    responseMimeType: 'application/json',
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        clarification_needed: {
          type: Type.BOOLEAN,
          description: "Vrai si le retour de l'utilisateur est ambigu et nécessite une question de relance",
        },
        clarification_question: {
          type: Type.STRING,
          nullable: true,
          description: "La question de relance à poser si clarification_needed est vrai",
        },
        updated_spec: {
          type: Type.STRING,
          nullable: true,
          description: 'Le document Markdown complet mis à jour',
        },
        current_summary: {
          type: Type.STRING,
          nullable: true,
          description: 'Synthèse globale à jour de la conception en 3 à 5 puces Markdown pour lecture mobile directe',
        },
        change_summary: {
          type: Type.STRING,
          nullable: true,
          description: 'Résumé synthétique en français (puces Markdown) des changements spécifiques apportés par ce dernier retour',
        },
        next_step: {
          type: Type.STRING,
          nullable: true,
          description: 'Prochaine étape d arbitrage ou invitation à valider par OK',
        },
      },
      required: ['clarification_needed'],
    },
  },
});

const resultText = response.text;
if (!resultText) {
  console.error('Réponse vide de Gemini.');
  process.exit(1);
}

const analysis = JSON.parse(resultText);

// Traitement selon le besoin de clarification
if (analysis.clarification_needed && analysis.clarification_question) {
  console.log('Clarification requise. Envoi de la relance.');
  await postIssueComment(
    `❓ **Précision nécessaire sur votre retour :**\n\n${analysis.clarification_question}`
  );

  await sendTelegramMessage(
    `❓ <b>Précision nécessaire sur la spécification</b>\n\n` +
      `📄 <b>Document :</b> <code>${specFile}</code>\n` +
      `📌 <b>Issue :</b> <a href="${event.issue.html_url}">#${issueNumber}</a>\n\n` +
      `💬 <b>Question :</b>\n${escapeHtml(analysis.clarification_question)}\n\n` +
      `👉 <i>Vous pouvez répondre directement sur l'application GitHub Mobile.</i>`
  );
  process.exit(0);
}

// Mise à jour du fichier de spécification
if (analysis.updated_spec) {
  fs.writeFileSync(specFile, analysis.updated_spec, 'utf-8');

  // Git commit & push
  execSync('git config user.name "github-actions[bot]"');
  execSync('git config user.email "github-actions[bot]@users.noreply.github.com"');
  execSync(`git add "${specFile}"`);

  // Vérification de la présence d'un diff
  const diff = execSync('git diff --staged --name-only').toString().trim();
  if (!diff) {
    console.log('Aucune modification détectée dans le fichier Markdown.');
    process.exit(0);
  }

  execSync(`git commit -m "docs(specs): actualisation suite aux retours sur issue #${issueNumber}"`);
  execSync(`git push origin ${defaultBranch}`);

  const commitSha = execSync('git rev-parse --short HEAD').toString().trim();
  console.log(`Commit poussé : ${commitSha}`);

  // Publication du commentaire autoportant sur l'issue (Mobile-First)
  const currentSummarySection = analysis.current_summary
    ? `### 📌 Synthèse de la conception (état actuel)\n${analysis.current_summary}\n\n`
    : '';
  const changeSummarySection = analysis.change_summary
    ? `### 🔄 Ce qui a changé\n${analysis.change_summary}\n\n`
    : '';
  const nextStepSection = `### ❓ Prochaine étape\n${
    analysis.next_step || "Si cette version vous convient, répondez simplement **OK** pour figer la spécification et lancer l'implémentation."
  }\n\n`;

  const githubComment =
    `✅ **Spécification actualisée** (commit [\`${commitSha}\`](${event.repository.html_url}/commit/${commitSha}))\n\n` +
    currentSummarySection +
    changeSummarySection +
    nextStepSection +
    `<details>\n<summary>📄 Voir le document complet (déroulant intégré)</summary>\n\n` +
    `${analysis.updated_spec}\n\n` +
    `</details>\n\n` +
    `---\n` +
    `📄 **Fichier source :** [\`${specFile}\`](${event.repository.html_url}/blob/${defaultBranch}/${specFile})`;

  await postIssueComment(githubComment);

  // Notification Telegram
  await sendTelegramMessage(
    `📝 <b>Spécification actualisée automatiquement</b>\n\n` +
      `📄 <b>Document :</b> <code>${specFile}</code>\n` +
      `📌 <b>Issue :</b> <a href="${event.issue.html_url}">#${issueNumber} ${escapeHtml(event.issue.title)}</a>\n` +
      `🔍 <b>Commit :</b> <code>${commitSha}</code>\n\n` +
      `📋 <b>Modifications :</b>\n` +
      `${escapeHtml(analysis.change_summary || '')}\n\n` +
      `📱 <i>Consultez la synthèse directement dans l'issue sur GitHub Mobile.</i>`
  );

  console.log('Cycle d\'intégration terminé avec succès.');
}
