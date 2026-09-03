---
name: telegram-test-runner
description: >-
  Protocole de recette et de validation interactive sur le bot Telegram dédié aux tests pour le projet agy-telegram.
  À utiliser lors du développement d'une fonctionnalité ou d'un correctif pour démarrer un runner temporaire isolé
  et l'arrêter impérativement dès que la pull request vers l'amont est soumise.
---

# Recette sur le bot Telegram dédié aux tests

Cette compétence encadre la validation fonctionnelle et interactive d'une évolution du bot `agy-telegram` (branche `feature/*`, `fix/*` ou `refactor/*`) avant sa soumission en pull request et son déploiement en production.

---

## 1. Contexte et isolation de l'environnement de test

Pour éviter de perturber le service en production géré par systemd (`agy-telegram.service`), les tests d'intégration réels sur Telegram s'effectuent sur une instance dédiée et éphémère.

* **Identifiant du bot de test :** `@Chromie_lemed_test_bot` (ID numérique : `8797558243`)
* **Configuration d'environnement :** `~/.config/agy-telegram-test/.env`
* **Utilisateur Telegram autorisé :** `704035925`
* **Fichier d'état isolé :** `~/.config/agy-telegram-test/state.json`
* **Répertoire temporaire isolé :** `~/.config/agy-telegram-test/tmp/`

L'instance de test utilise son propre fichier d'état et son propre dossier temporaire afin de garantir une étanchéité absolue avec la production.

---

## 2. Procédure de recette en 4 étapes

### Étape 1 : Compilation préalable
Avant de lancer le runner de test, compiler obligatoirement les sources TypeScript :

```bash
cd /home/med/projets/agy-telegram
npm run build
```

### Étape 2 : Lancement du runner temporaire de test
Démarrer le bot de test en précisant explicitement le fichier d'environnement dédié :

```bash
AGY_ENV_FILE=$HOME/.config/agy-telegram-test/.env node dist/cli.js
```

> **Note :** Si exécuté par un agent, ce processus doit être lancé en tâche de fond (ou terminal persistant) pendant toute la phase de vérification interactive sur Telegram.

### Étape 3 : Validation interactive sur Telegram
1. Ouvrir la conversation Telegram avec le bot de test ([@Chromie_lemed_test_bot](https://t.me/Chromie_lemed_test_bot) ou ID `8797558243`).
2. Exécuter les scénarios de test ciblés par l'évolution :
   * Commandes usuelles (`/start`, `/menu`, `/model`, `/workspace`, etc.).
   * Prompts spécifiques testant la nouvelle fonctionnalité.
   * Vérification des transitions, retours visuels et absence d'erreur dans la console du runner.

### Étape 4 : Arrêt obligatoire dès soumission de la pull request
> ⚠️ **Règle absolue :** Dès que la validation est concluante et que la pull request vers l'amont (*upstream*) est ouverte et soumise, **le runner temporaire de test doit être immédiatement arrêté**.

Arrêter le processus en cours d'exécution :
```bash
pkill -f "agy-telegram-test"
```
Ou terminer la tâche d'arrière-plan correspondante. Aucun runner éphémère ne doit continuer de tourner en tâche de fond après l'ouverture de la pull request.

---

## 3. Synthèse des commandes

Action | Commande
:--- | :---
**Compiler** | `npm run build`
**Lancer le runner de test** | `AGY_ENV_FILE=$HOME/.config/agy-telegram-test/.env node dist/cli.js`
**Arrêter le runner de test** | `pkill -f "agy-telegram-test"` ou interruption de la tâche
