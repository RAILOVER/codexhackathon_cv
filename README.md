# GOAT your Job — agent de candidature spontanée

## Démo web

L’agent GOAT your Job accepte uniquement un CV **PDF ou TXT** (4 Mo maximum). La zone est automatiquement fixée à **« Monde entier »**. Une exécution lance l’extraction du CV, la recherche de levées récentes, l’enrichissement légal, la recherche d'un contact public, le scoring, puis la génération d'un email, d'une lettre et d'un CV adaptés pour chaque entreprise.

```bash
pnpm install
pnpm dev
```

Ouvrir ensuite [http://localhost:3000](http://localhost:3000). Les sources Maddyness et Recherche Entreprises sont utilisées lorsque le réseau est disponible ; sinon le site charge automatiquement six entreprises réelles sauvegardées dans `data/role1-results.json`.

Les contenus adaptés sont générés de manière factuelle à partir du CV et des données entreprise, sans inventer de métriques. Les boutons permettent de copier un email public, d’ouvrir une page contact ou de télécharger le CV/la lettre en PDF.

## Agent portable (sans interface)

Le point d'entrée de l'agent est [`src/agent.ts`](src/agent.ts). Il ne demande qu'un CV : du texte déjà extrait (`cvText`) ou un fichier PDF/TXT encodé en base64 (`cvFile`). La zone est fixée par le code à `Monde entier` ; il n'existe ni champ lettre de motivation ni champ zone géographique.

```bash
pnpm agent:run data/agent-input.example.json
```

La sortie JSON contient `companies` (6 maximum) avec le score, le contact public (email sinon URL de contact), l'identité légale et `application` (email, lettre et CV adaptés). L'exemple active `forceCache: true` uniquement pour une démo hors ligne ; omettre ce champ pour lancer la collecte Maddyness en direct.

### Lettres améliorées par IA

La fonction `analyze` utilise le SDK OpenAI côté serveur pour rédiger chaque lettre de motivation avec `gpt-4.1-mini`, à partir du CV structuré et des faits vérifiés sur l’entreprise. Elle conserve un repli factuel si l’IA est indisponible.

Sur **Netlify**, activer **AI Gateway** dans le tableau de bord après le premier déploiement de production. Ne pas ajouter de clé `OPENAI_API_KEY` manuellement : Netlify injecte les identifiants temporaires nécessaires dans la fonction, sans les exposer au navigateur. En local ou sur un autre hébergeur, une clé `OPENAI_API_KEY` peut être définie uniquement dans l’environnement serveur.

## Déploiement Netlify

Le dépôt contient déjà la configuration de déploiement :

- `public/` : site statique GOAT your Job ;
- `netlify/functions/analyze.mts` : endpoint serverless `POST /api/analyze` ;
- `netlify.toml` : publication, build TypeScript et cache embarqué.

Dans Netlify, connecter le dépôt GitHub puis utiliser ces paramètres :

| Paramètre | Valeur |
| --- | --- |
| Build command | `pnpm check` |
| Publish directory | `public` |
| Functions directory | `netlify/functions` |
| Node | `24` |

Ne stocker aucune clé API dans le dépôt. La démo actuelle ne dépend d’aucune clé : elle bascule sur le cache si une source externe est indisponible.

## Étape 1 - Sourcing des levées de fonds

Le scraper part de la page Maddyness des levées de fonds, suit les derniers articles MaddyMoney, puis enrichit les entreprises grâce à leurs fiches Maddyness. Il retourne pour chaque entrée :

- nom de l'entreprise ;
- description courte ;
- date de la levée ;
- URL de l'article source ;
- URL de la fiche entreprise ;
- site officiel quand il est renseigné.

### Lancer le scraper

```bash
pnpm install
pnpm scrape:fundings
```

Le script affiche les cinq premières entreprises et génère `data/latest-fundings.json`. Ce fichier est volontairement ignoré par Git : son contenu dépend de la date d'exécution.

### Mode démo

`data/fallback-fundings.json` contient quatre levées déjà vérifiées. L'interface pourra l'utiliser si Maddyness est indisponible.

## Étape 2 - Identification légale et zone géographique

```bash
# toutes les entreprises de la dernière collecte
pnpm enrich:legal

# seulement celles dont le siège est dans la zone demandée
pnpm enrich:legal "Île-de-France"
pnpm enrich:legal "Paris"
pnpm enrich:legal "75009"
```

L'enrichissement utilise l'API publique Recherche Entreprises et ajoute le SIREN, la catégorie juridique, le premier dirigeant public et les coordonnées du siège. La zone géographique filtre le **siège social** après l'enrichissement légal ; Maddyness n'est pas utilisé comme filtre géographique car cette information n'est pas fiable dans chaque article.

## Étape 3 - Contact public

```bash
pnpm find:contacts
```

Le module visite uniquement des pages publiques du site officiel : accueil, `/contact`, `/contact-us`, `/nous-contacter`, `/about`, `/team`, `/a-propos` et `/equipe`, puis les liens contact qu'il découvre sur place. Il privilégie un email public ; sans email, il retourne une page contact. Les réseaux sociaux sont volontairement exclus.

## Étape 4 - CV structuré et matching

```bash
# Remplacer ensuite le fichier de démonstration par le CV texte du candidat
pnpm extract:cv data/sample-cv.txt
pnpm score:matches
```

`extract:cv` produit un JSON contenant compétences, intitulés de poste, expériences et rôles cibles. Il fonctionne hors ligne avec un extracteur heuristique et fournit aussi une interface LLM (`extractCvProfileWithLlm`) qui valide le même contrat JSON avant le scoring.

`score:matches` compare ce profil aux descriptions des entreprises, attribue un score de 0 à 1, explique les correspondances et conserve les huit meilleurs résultats au maximum.

## Export rôle 1

```bash
pnpm export:role1
```

Le fichier `data/role1-results.json` est le contrat à transmettre aux rôles Génération et Interface. Il rassemble, pour les huit meilleures entreprises au maximum, les informations de levée, identité légale, contact public et justification de matching.

### Périmètre

Cette étape collecte les entreprises sans filtrer selon le CV. L'extraction du CV et le scoring seront ajoutés à l'étape de matching afin de ne pas écarter des entreprises avant de connaître le profil du candidat.
