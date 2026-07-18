# Agent de candidature spontanée

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
