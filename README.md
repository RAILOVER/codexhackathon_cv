# GOAT Your Job — Agent API

Un agent qui reçoit un **CV uniquement** et retourne une sélection d’entreprises ayant levé des fonds récemment, avec le contact public disponible et une candidature adaptée par entreprise.

## Une seule API

`POST /api/agent`

Déploiement : `GET /api/health` retourne un statut JSON lorsque la fonction
Netlify est bien publiée. La racine `/` affiche une page d’état minimale afin
qu’un déploiement ne réponde jamais par une 404 silencieuse.

Entrée JSON :

```json
{
  "fileName": "cv.pdf",
  "mimeType": "application/pdf",
  "fileBase64": "<contenu-base64-du-CV>"
}
```

Le CV peut être un PDF ou un TXT (4 Mo maximum). La zone est fixée à `Monde entier`.

La réponse contient :

- le profil extrait : compétences, intitulés et expériences ;
- jusqu’à six entreprises récemment financées, classées par pertinence ;
- SIREN, forme juridique et dirigeant quand la source officielle les trouve ;
- un email public, sinon la page contact ;
- un email, une lettre de motivation et un CV adaptés pour chaque entreprise.

## Fonctionnement

1. Extraction du texte du CV en préservant les lignes du PDF.
2. Extraction de compétences et expériences couvrant les profils tech, commerce, opérations, finance, droit, recherche, santé, création et management.
3. Collecte des levées récentes sur Maddyness, enrichissement légal et recherche de contact public.
4. Matching CV ↔ entreprise, puis génération de candidatures.

L’agent utilise un cache de six entreprises vérifiées si une source externe est indisponible. Lorsqu’une clé OpenAI est présente côté serveur, il améliore la lettre de motivation et l’extraction structurée ; sinon un repli local reste fonctionnel.

## Lancer localement

```bash
pnpm install
pnpm agent:run data/agent-input.example.json
```

`data/agent-input.example.json` active le cache uniquement pour une démonstration reproductible. L’endpoint API lance la recherche en direct et bascule automatiquement sur le cache si nécessaire.

## Déploiement Netlify

Le dépôt expose une seule fonction serverless dans `netlify/functions/agent.mts`. La configuration Netlify est déjà incluse ; définir les secrets uniquement côté serveur, jamais dans le dépôt.
