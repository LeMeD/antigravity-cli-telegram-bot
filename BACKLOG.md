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
- [x] **PR #28** : Isolation de workspace par session et topic (`/workspace`) selon le modèle d'architecture Option A avec autocomplétion, claviers inline, notice visuelle et confinement de sécurité (`isWithin`). *(Fusionnée dans upstream/main, clôture l'issue #26)*
  - Lien : https://github.com/ardiannurcahya/antigravity-cli-telegram-bot/pull/28
- [x] **PR #30** : Isolation des tours intermédiaires de délégation et de sous-agents dans des citations dépliables natives Telegram (`<blockquote expandable>`), avec ticker télémétrique compact et respect des modes de verbosité (`verbose: "detailed"` vs `compact`). *(Fusionnée dans upstream/main, clôture l'issue #29)*
  - Lien : https://github.com/ardiannurcahya/antigravity-cli-telegram-bot/pull/30
- [x] **Finalisation et intégration en production de la PR #30** :
  - Procédure de synchronisation exécutée avec succès (alignement sur upstream/main, synchronisation sur fork/main et private/main, suppression des branches de feature et de PR, compilation TypeScript et rechargement du service systemd).

---

## 2. Procédure opérationnelle de synchronisation post-fusion (PR #30)

Suite à la validation et fusion de la PR #30 par Ardian, la séquence suivante a été exécutée pour aligner l'instance locale en production :

```bash
# 1. Se positionner sur la branche principale et récupérer les commits fusionnés
cd /home/med/projets/agy-telegram
git checkout main
git fetch upstream
git merge upstream/main -m "merge: align with upstream/main after PR #30"

# 2. Rapatrier la documentation et actualiser le backlog
git checkout feature/subagent-delegation-expandable-quote -- docs/ .agents/skills/telegram-test-runner/SKILL.md
# Actualisation de BACKLOG.md et commit documentaire

# 3. Valider et compiler le code TypeScript
npm test
npm run build

# 4. Mettre à jour les branches main distantes sur GitHub
git push fork main
git push origin main
git push private main

# 5. Nettoyer les branches obsolètes
git push fork --delete pr/feature/subagent-delegation-expandable-quote
git push fork --delete feature/subagent-delegation-expandable-quote
git branch -d feature/subagent-delegation-expandable-quote

# 6. Redémarrer le service systemd du bot
systemctl --user restart agy-telegram
```

### Vérifications post-bascule
1. Contrôler le statut du service : `systemctl --user status agy-telegram`.
2. Envoyer un prompt impliquant un sous-agent (ex. invocation de `research`) sur Telegram pour confirmer le repliement des étapes intermédiaires dans un bloc `<blockquote expandable>`.
3. Vérifier la fluidité du ticker d'avancement et l'absence d'erreur dans les journaux : `journalctl --user -u agy-telegram -f`.

---

## 3. Améliorations futures et pistes d'évolution

- [x] **Isolation de workspace par session et topic (/workspace)** : Portée dynamique du répertoire de travail (`cwd`), autocomplétion native Telegram et sélection interactive par boutons inline, résolution flexible avec préfixe slash (`/`), rappel visuel du workspace forcé au prompt, réinitialisation éphémère en DM 1:1 sur `/new` (Option A) et persistance par forum topic, sécurisé par vérification de confinement (`isWithin`) ([Issue #26](https://github.com/ardiannurcahya/antigravity-cli-telegram-bot/issues/26), [PR #28](https://github.com/ardiannurcahya/antigravity-cli-telegram-bot/pull/28), [Spécifications](docs/specs/per-session-workspace-isolation.md)).
- [ ] **Transcription vocale automatique (Speech-to-Text / STT)** : Transcription automatique des messages vocaux Telegram en prompts textuels directs via Gemini Speech ou Whisper ([Issue #1](https://github.com/LeMeD/agy-telegram-private/issues/1), [Spécifications](docs/specs/speech-to-text-transcription.md)).
- [ ] ~~**Internationalisation (i18n)**~~ : Possibilité de configurer la langue des messages système du bot (français / anglais) *(Piste abandonnée suite à arbitrage sur [Issue #2](https://github.com/LeMeD/agy-telegram-private/issues/2)).*
- [ ] **Gestion avancée des quotas** : Alertes Telegram paramétrables lorsque le quota approche d'un seuil critique (ex. 80 %) ([Issue #3](https://github.com/LeMeD/agy-telegram-private/issues/3)).
- [ ] **Commandes rapides personnalisées** : Permettre la définition d'alias de prompts personnalisés depuis l'interface utilisateur ([Issue #4](https://github.com/LeMeD/agy-telegram-private/issues/4)).
- [x] **Affichage en direct des transitions d'agents et délégation de sous-agents (Option 2.5)** : Ticker de progression compact et télémétrique pendant l'exécution, isolation des tours intermédiaires dans le flux de réponse et restitution sous forme de bloc de citation dépliable Telegram (`<blockquote expandable>`), évitant toute pollution du compte-rendu final ([Issue #29](https://github.com/ardiannurcahya/antigravity-cli-telegram-bot/issues/29), [PR #30](https://github.com/ardiannurcahya/antigravity-cli-telegram-bot/pull/30), [Spécifications](docs/specs/subagent-delegation-turn-isolation.md)). *(Fusionnée dans upstream/main)*
- [x] **Environnement de recette et bot Telegram dédié aux tests** : Mise en place de la compétence locale de projet ([telegram-test-runner](.agents/skills/telegram-test-runner/SKILL.md)) et configuration isolée (`~/.config/agy-telegram-test/.env`) pour valider les évolutions sur le bot de test dédié (`8797558243`) avec cycle de vie éphémère (fermeture impérative du runner temporaire dès soumission de la PR).

