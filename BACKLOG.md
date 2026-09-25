# Carnet de route et backlog du projet agy-telegram

Ce document assure le suivi opérationnel, l'état d'avancement des contributions et la feuille de route du bot Telegram pour Antigravity CLI.

---

## 1. Suivi des contributions et transition vers le fork officiel

Historiquement développé sur une version personnalisée (`agy-telegram-custom`), le projet bascule vers le fork officiel (`LeMeD/antigravity-cli-telegram-bot`) en miroir du dépôt amont (`ardiannurcahya/antigravity-cli-telegram-bot`).

### État des pull requests

- [x] **PR #19** : Alignement des modèles Gemini par défaut (Gemini 3.8 Flash High/Medium/Low, Gemini 3.7, Claude, GPT) avec calcul dynamique du contexte. *(Fusionnée dans upstream/main)*
- [x] **PR #22** : Rendu propre des liens de conversation `conversation://` et de fichiers `file://` en HTML Telegram, durcissement de l'analyse des commandes AGY et résilience SQLite. *(Fusionnée dans upstream/main)*
- [x] **PR #23** : Prise en charge des documents images non compressés, résilience réseau avec backoff pour les téléchargements de fichiers et gestion du cycle de vie des fichiers temporaires (purge sur `/new` et fichiers de plus de 24h). *(Fusionnée dans upstream/main)*
  - Lien : https://github.com/ardiannurcahya/antigravity-cli-telegram-bot/pull/23
- [x] **PR #28** : Isolation de workspace par session et topic (`/workspace`) avec autocomplétion, claviers inline, notice visuelle et confinement de sécurité (`isWithin`). *(Fusionnée dans upstream/main, clôture l'issue #26)*
  - Lien : https://github.com/ardiannurcahya/antigravity-cli-telegram-bot/pull/28
- [x] **PR #30** : Isolation des tours intermédiaires de délégation et de sous-agents dans des citations dépliables natives Telegram (`<blockquote expandable>`), avec ticker télémétrique compact et respect des modes de verbosité (`verbose: "detailed"` vs `compact`). *(Fusionnée dans upstream/main, clôture l'issue #29)*
  - Lien : https://github.com/ardiannurcahya/antigravity-cli-telegram-bot/pull/30
- [x] **PR #32** : Robustesse du parseur Telegram Markdown face aux blocs de code imbriqués (*nested code fences*), préservation des accolades TypeScript/JSON dans le texte ordinaire et découpage sécurisé aux frontières de mots (*word boundary split*). *(Fusionnée dans upstream/main)*
  - Lien : https://github.com/ardiannurcahya/antigravity-cli-telegram-bot/pull/32
- [x] **PR #38** : Nettoyage des mentions résiduelles d'« Option A » dans le `README.md` et alignement documentaire avec le standard nominal du bot. *(Fusionnée dans upstream/main, clôture l'issue #6)*
  - Lien : https://github.com/ardiannurcahya/antigravity-cli-telegram-bot/pull/38
- [x] **PR #41** : Refonte de `/menu` avec 3 profils d'interface (`daily`, `dev`, `mixed`), sélecteur de profil en direct, préchauffage Whisper non bloquant et renouvellement du statut de saisie Telegram. *(Fusionnée dans upstream/main)*
  - Lien : https://github.com/ardiannurcahya/antigravity-cli-telegram-bot/pull/41
- [x] **PR #42 (Issue #40)** : Compaction de contexte orchestrateur via pipeline de passation 3 temps (`/compact`), télémétrie dynamique des jetons sur les boutons de menu, clavier inline sous `/context` et propagation de workspace via `--add-dir`. *(Fusionnée dans upstream/main, clôture l'issue #40)*
  - Spécification : `docs/specs/orchestrator-context-compaction.md`
  - Pull Request : https://github.com/ardiannurcahya/antigravity-cli-telegram-bot/pull/42
  - Issue résolue : https://github.com/ardiannurcahya/antigravity-cli-telegram-bot/issues/40
- [x] **Finalisation et intégration en production de la PR #42** :
  - Procédure de synchronisation exécutée avec succès (alignement sur upstream/main, synchronisation sur fork/main, origin/main et private/main, suppression des branches de feature et de PR, compilation TypeScript et rechargement du service systemd).
- [x] **PR #43** : Actualisation automatique de la télémétrie de contexte actif post-réponse via sonde PTY `/context`, rafraîchissement in-place multi-écrans du menu Telegram (`main` et `clitools`), et synthèse de compactage succincte sans préambule conversationnel avec extraction propre de l'objectif. *(Fusionnée dans upstream/main)*
  - Lien : https://github.com/ardiannurcahya/antigravity-cli-telegram-bot/pull/43
- [x] **Finalisation et intégration en production de la PR #43** :
  - Procédure de synchronisation exécutée avec succès (alignement sur upstream/main, synchronisation sur fork/main, origin/main et private/main, suppression des branches de feature et de PR, compilation TypeScript et rechargement du service systemd).
- [x] **PR #48 (RFC #46 / Issue #8)** : Parité des fonctionnalités AGY CLI - Phase 1 (Directives de prompt natives `/plan`, `/boost`, `/goal`, `/grill-me`, commande d'inspection Git `/diff` adaptative, et renommage de session active `/title` et `/rename`). *(Fusionnée dans upstream/main)*
  - Pull Request : https://github.com/ardiannurcahya/antigravity-cli-telegram-bot/pull/48
  - RFC amont associée : https://github.com/ardiannurcahya/antigravity-cli-telegram-bot/issues/46
  - Spécification : `docs/specs/agy-cli-feature-parity.md`
- [x] **Finalisation et intégration en production de la PR #48** :
  - Procédure de synchronisation exécutée avec succès (alignement sur upstream/main, synchronisation sur fork/main, origin/main et private/main, suppression des branches de feature et de PR, compilation TypeScript et rechargement du service systemd).
- [x] **PR #50 (RFC #47 / Issue #9)** : Rationalisation de la télémétrie post-prompt et volet déroulant mobile (`<blockquote expandable>` en anglais, séparation nette *This turn* et *Session totals*, calcul du *Context growth*, et diagnostics d'intégrité). *(Fusionnée dans upstream/main, clôture l'issue privée #9 et la RFC amont #47)*
  - Pull Request : https://github.com/ardiannurcahya/antigravity-cli-telegram-bot/pull/50
  - RFC amont associée : https://github.com/ardiannurcahya/antigravity-cli-telegram-bot/issues/47
  - Issue privée : https://github.com/Homeboyz-IT/agy-telegram-private/issues/9
  - Spécification : `docs/specs/telemetry-metrics-rationalization.md`
- [x] **Finalisation et intégration en production de la PR #50** :
  - Procédure de synchronisation exécutée avec succès (alignement sur upstream/main, synchronisation sur fork/main, origin/main et private/main, suppression des branches de feature et de PR, compilation TypeScript et rechargement du service systemd).
- [x] **PR #51** : Suppression de l'en-tête redondant de workspace sur les messages de réponse finale (éliminant la régression d'affichage des balises HTML brutes) et harmonisation Markdown pour les notes de handover de compaction. *(Fusionnée dans upstream/main)*
  - Pull Request : https://github.com/ardiannurcahya/antigravity-cli-telegram-bot/pull/51
- [x] **Finalisation et intégration en production de la PR #51** :
  - Procédure de synchronisation exécutée avec succès (alignement sur upstream/main, synchronisation sur fork/main, origin/main et private/main, suppression des branches de fix et de PR, compilation TypeScript et rechargement du service systemd).

---

## 2. Procédure opérationnelle de synchronisation post-fusion (PR #51)

Suite à la validation et fusion de la PR #51 par Ardian (@ardiannurcahya), la séquence suivante a été exécutée pour aligner l'instance locale en production :

```bash
# 1. Se positionner sur la branche principale et récupérer les commits fusionnés
cd /home/med/projets/agy-telegram
git checkout main
git fetch upstream
git merge upstream/main -m "merge: align with upstream/main after PR #51 (workspace banner removal)"

# 2. Actualiser le carnet de route (BACKLOG.md et spécifications)
# Actualisation de BACKLOG.md et commit documentaire

# 3. Valider et compiler le code TypeScript
npm test
npm run build

# 4. Mettre à jour les branches main distantes sur GitHub
git push fork main
git push origin main
git push private main

# 5. Nettoyer les branches obsolètes
git push fork --delete pr/feature/post-prompt-telemetry feature/post-prompt-telemetry
git push origin --delete pr/feature/post-prompt-telemetry feature/post-prompt-telemetry 2>/dev/null || true
git push private --delete feature/post-prompt-telemetry
git branch -D feature/post-prompt-telemetry pr/feature/post-prompt-telemetry 2>/dev/null || true

# 6. Redémarrer le service systemd du bot
systemd-run --user --on-active=5s systemctl --user restart agy-telegram
```

### Vérifications post-bascule
1. Contrôler le statut du service : `systemctl --user status agy-telegram`.
2. Tester la réception de la télémétrie post-prompt dans une bulle dédiée dépliable (`<blockquote expandable>`).
3. Tester la complétion de session avec diagnostic d'outils et contexte actif actualisé.
4. Vérifier la fluidité des réponses et l'absence d'erreur dans les journaux : `journalctl --user -u agy-telegram -f`.

---

## 3. Améliorations futures et pistes d'évolution

- [x] **Isolation de workspace par session et topic (/workspace)** : Portée dynamique du répertoire de travail (`cwd`), autocomplétion native Telegram et sélection interactive par boutons inline, résolution flexible avec préfixe slash (`/`), rappel visuel du workspace forcé au prompt, réinitialisation éphémère en DM 1:1 sur `/new` et persistance par forum topic, sécurisé par vérification de confinement (`isWithin`) ([Issue #26](https://github.com/ardiannurcahya/antigravity-cli-telegram-bot/issues/26), [PR #28](https://github.com/ardiannurcahya/antigravity-cli-telegram-bot/pull/28), [Spécifications](docs/specs/per-session-workspace-isolation.md)).
- [x] **Nettoyage des mentions résiduelles d'« Option A » (README et tests)** : Suppression des références à l'ancienne désignation « Option A » au profit du modèle standard nominal du bot (Issue #6, [PR #38](https://github.com/ardiannurcahya/antigravity-cli-telegram-bot/pull/38), [Spécifications](docs/specs/per-session-workspace-isolation.md)). *(Fusionnée dans upstream/main)*
- [ ] ~~**Transcription vocale automatique (Speech-to-Text / STT)** : Transcription automatique des messages vocaux Telegram en prompts textuels directs via Gemini Speech ou Whisper ([Issue #1](https://github.com/LeMeD/agy-telegram-private/issues/1), [Spécifications](docs/specs/speech-to-text-transcription.md)).~~ *(Piste abandonnée suite à arbitrage sur [Issue #1])*
- [ ] ~~**Internationalisation (i18n)**~~ : Possibilité de configurer la langue des messages système du bot (français / anglais) *(Piste abandonnée suite à arbitrage sur [Issue #2](https://github.com/LeMeD/agy-telegram-private/issues/2)).*
- [ ] **Gestion avancée des quotas** : Alertes Telegram paramétrables lorsque le quota approche d'un seuil critique (ex. 80 %) ([Issue #3](https://github.com/LeMeD/agy-telegram-private/issues/3)).
- [ ] **Commandes rapides personnalisées** : Permettre la définition d'alias de prompts personnalisés depuis l'interface utilisateur ([Issue #4](https://github.com/LeMeD/agy-telegram-private/issues/4)).
- [x] **Affichage en direct des transitions d'agents et délégation de sous-agents (Option 2.5)** : Ticker de progression compact et télémétrique pendant l'exécution, isolation des tours intermédiaires dans le flux de réponse et restitution sous forme de bloc de citation dépliable Telegram (`<blockquote expandable>`), évitant toute pollution du compte-rendu final ([Issue #29](https://github.com/ardiannurcahya/antigravity-cli-telegram-bot/issues/29), [PR #30](https://github.com/ardiannurcahya/antigravity-cli-telegram-bot/pull/30), [Spécifications](docs/specs/subagent-delegation-turn-isolation.md)). *(Fusionnée dans upstream/main)*
- [x] **Environnement de recette et bot Telegram dédié aux tests** : Mise en place de la compétence locale de projet ([telegram-test-runner](.agents/skills/telegram-test-runner/SKILL.md)) et configuration isolée (`~/.config/agy-telegram-test/.env`) pour valider les évolutions sur le bot de test dédié (`8797558243`) avec cycle de vie éphémère (fermeture impérative du runner temporaire dès soumission de la PR).
- [x] **Synchronisation en direct du contexte actif réel et rafraîchissement immédiat du menu** : Capture fidèle de la taille réelle de la mémoire vive du modèle (via les *input tokens* du dernier tour LLM plutôt que le cumul d'exécution global), fiabilisation du calcul mathématique du pourcentage dans `parseContextMetrics`, et réédition automatique en place du clavier du panneau de contrôle Telegram (`editMessageReplyMarkup`) dès que l'agent passe en stand-by ou que `/context` est rafraîchi ([PR #43](https://github.com/ardiannurcahya/antigravity-cli-telegram-bot/pull/43)). *(Fusionnée dans upstream/main)*
- [x] **Rationalisation de la télémétrie post-prompt et volet déroulant mobile** : Indicateurs opérationnels en volet déroulant natif Telegram (`<blockquote expandable>`), message télémétrique dédié, séparation nette *This turn* et *Session totals*, vérité terrain via input tokens du tour LLM et sonde PTY, calcul de l'accroissement net de contexte (*Context growth*), alertes visuelles ciblées (0 outil exécuté) et libellés normalisés en anglais ([Issue privée #9](https://github.com/Homeboyz-IT/agy-telegram-private/issues/9), [RFC upstream #47](https://github.com/ardiannurcahya/antigravity-cli-telegram-bot/issues/47), [PR amont #50](https://github.com/ardiannurcahya/antigravity-cli-telegram-bot/pull/50), [Spécifications](docs/specs/telemetry-metrics-rationalization.md)). *(Fusionnée dans upstream/main)*
- [x] **Parité des fonctionnalités AGY CLI - Phase 1 (Directives de prompt, /diff, /title)** : Passthrough des directives de prompt natives (`/plan`, `/boost`, `/goal`, `/grill-me`) vers la file AGY via allowlist explicite, inspection Git `/diff` adaptative (rendu court dans le fil ou document `.diff` joint si volumineux) et renommage de session active `/title` pour faciliter la navigation dans `/resume` ([Issue #8](https://github.com/Homeboyz-IT/agy-telegram-private/issues/8), [RFC upstream #46](https://github.com/ardiannurcahya/antigravity-cli-telegram-bot/issues/46), [PR amont #48](https://github.com/ardiannurcahya/antigravity-cli-telegram-bot/pull/48), [Spécifications](docs/specs/agy-cli-feature-parity.md)). *(Fusionnée dans upstream/main)*
- [ ] **Parité des fonctionnalités AGY CLI - Phase 2 (Écosystème CLI : /skills et /mcp)** : Intégration des commandes natives `/skills` et `/mcp` aux côtés de `/plugins` et `/agents` dans le menu CLI & Tools ([Issue #8](https://github.com/Homeboyz-IT/agy-telegram-private/issues/8), [RFC upstream #46](https://github.com/ardiannurcahya/antigravity-cli-telegram-bot/issues/46)).
- [ ] **Parité des fonctionnalités AGY CLI - Phase 3 (Cycle de session avancé : /btw, /fork, /rewind)** : Gestion avancée d'état, isolation d'invites incidentes et bifurcation de session dans SQLite ([Issue #8](https://github.com/Homeboyz-IT/agy-telegram-private/issues/8), [RFC upstream #46](https://github.com/ardiannurcahya/antigravity-cli-telegram-bot/issues/46)).
- [~] **Gestion du cycle de vie asynchrone des sous-agents et auto-notification Telegram** : Gestion du cycle de vie asynchrone lors des délégations via `invoke_subagent` (/boost, modèles autonomes, règles projet), arbitrage entre auto-polling passerelle et driver persistant bidirectionnel (`--input-format stream-json`), et délivrance spontanée de la synthèse finale sur Telegram ([Issue #10](https://github.com/Homeboyz-IT/agy-telegram-private/issues/10), [RFC amont #49](https://github.com/ardiannurcahya/antigravity-cli-telegram-bot/issues/49), [Spécifications](docs/specs/subagent-async-lifecycle-notification.md)).

