/**
 * Script d'intégration continue et autonome des spécifications Markdown.
 *
 * Déclenché par GitHub Actions sur l'événement `issue_comment`.
 * Analyse les arbitrages du propriétaire, met à jour le fichier Markdown de spécification
 * via Gemini Flash, committe les changements, commente l'issue et notifie sur Telegram.
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

// B. Présence du label "spec"
const isSpecIssue = event.issue?.labels?.some((l) => l.name === 'spec');
if (!isSpecIssue) {
  console.log("L'issue ne comporte pas le label 'spec'. Exécution ignorée.");
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

async function closeIssue() {
  if (!GITHUB_TOKEN) return;
  const url = `https://api.github.com/repos/${repoFullName}/issues/${issueNumber}`;
  await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Spec-Automation-Agent',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ state: 'closed' }),
  });
}

// 3. Résolution du fichier de spécification concerné
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
if (!specFile) {
  console.error('Impossible d\'identifier le fichier de spécification associé.');
  process.exit(1);
}

console.log(`Spécification ciblée : ${specFile}`);

// 4. Cas 1 : Validation finale (l'utilisateur approuve la spécification)
const isApproval =
  /^(ok|validé|valide|approuvé|approuve|conforme|terminé|clôturer|merci ok)\b/i.test(commentBody) ||
  /^\/valider\b/i.test(commentBody) ||
  /^\/ok\b/i.test(commentBody);

if (isApproval) {
  console.log('Approbation détectée. Clôture de l\'issue et validation de la spécification.');
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
    // Passe les cases [ ] ou [~] associées à cette spec à [x] ou validé
    backlog = backlog.replace(
      new RegExp(`\\[[ ~]\\] (.*${specBasename}.*)`, 'g'),
      '[~] $1'
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

  await closeIssue();

  await sendTelegramMessage(
    `🎉 <b>Spécification validée et clôturée</b>\n\n` +
      `📄 <b>Document :</b> <code>${specFile}</code>\n` +
      `📌 <b>Issue :</b> <a href="${event.issue.html_url}">#${issueNumber} ${escapeHtml(event.issue.title)}</a>\n\n` +
      `<i>La conception est figée, la fonctionnalité est prête pour le développement.</i>`
  );

  console.log('Clôture effectuée avec succès.');
  process.exit(0);
}

// 5. Cas 2 : Amendement / Arbitrage à intégrer via Gemini Flash
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
    analysis.next_step || 'Si cette version vous convient, répondez simplement **OK** pour figer la spécification et lancer l\'implémentation.'
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
