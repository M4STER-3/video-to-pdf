# Validation Auto 2 — 7 septembre 2026

## Nature des vérifications

**Les vérifications ci-dessous sont exécutées ; l’iPad physique n’a pas été testé.** Le moteur JavaScript a été exécuté dans V8, sans Node.js. Les fonctions de lecture vidéo et de capture ont des adaptateurs déterministes pour les tests d’intégration ; les interactions de l’application utilisent un DOM simulé. De vrais caractères rastérisés et anticrénelés sont inclus pour vérifier une modification de chiffre. La vidéo utilisateur `Unknown.mp4` a aussi été inspectée image par image (voir plus bas).

Aucun navigateur n’a été piloté. Le skill `control-browser` impose un environnement Node.js pour son pilotage, ce qui est exclu par les consignes de ce projet. La page `tests/index.html` permet de réexécuter les tests depuis GitHub Pages sans installation ; elle ne transforme pas ces scénarios simulés en validation Safari réelle.

## Résultats

Les résultats nommés sont conservés dans `tests/results.json`. La suite du moteur couvre **35 tests**, complétés par **12 contrôles d’interactions simulées**.

| Domaine | Vérification |
| --- | --- |
| Pause de 0,5 seconde | Détectée pour douze décalages de l’arrêt par rapport aux observations ; vérifiée aussi dans le parcours A → B → A. |
| Longue pause | Une seule fenêtre candidate sur dix secondes, sans capture périodique. |
| Défilement | Aucun intervalle stable retenu dans les cas testés de scroll lent continu et rapide. |
| Déplacement | Estimation horizontale et verticale sur des motifs de texte ; petite correction reconnue comme doublon. |
| Animation | Clignotement local ignoré ; changement local persistant reconnu. |
| Petits détails | Un changement local, une petite différence entourée de marges et les vrais textes « Total : 17 » / « Total : 18 » ne sont pas assimilés à un doublon confirmé. |
| Bruit et doublons | Copie exacte, bruit faible de compression, retour à une ancienne page et désactivation de la déduplication. |
| Recadrage | Documents clairs et sombres, menu temporaire, absence de bords fiables, ligne fine de tableau. Les bords attendus restent à l’intérieur du cadre conservé. |
| Qualité | Les caractères nets obtiennent un meilleur score que leur version floutée ; une candidate floue au milieu d’une pause n’est pas choisie dans le scénario testé. |
| Images sans contenu | Un écran entièrement vide n’est pas extrait comme page. |
| Robustesse | Calibration bornée, seeks séquentiels, même timestamp, annulation avant et pendant un seek, erreur de décodage, annulation de l’analyse, limite mémoire simulée. |
| Libération | Nettoyage des écouteurs et des quatre samplers, y compris après erreur d’extraction. |
| Progression | Pourcentage non décroissant dans l’analyse et arrivée à 100 % après succès. |
| Interactions | Import suivi automatiquement du cadrage et de l’analyse ; ordre tactile ; suppression/restauration ; aperçu original et validation ; correction de cadre annulée ; refus des réglages invalides ; verrou contre deux traitements simultanés ; révocation des URL d’aperçu. |

## Essai sur `Unknown.mp4`

L’extrait fourni (9,3 s, 960 × 720, 30 i/s) contient six pages uniques. L’inspection multi-images retrouve les états A → B → C → A → D → E → F → F avec overlay ; le retour à A et la variante finale de F sont donc des doublons attendus, pas des pages supplémentaires. Le recadrage renforcé retrouve une zone documentaire d’environ **x=240, y=60, 486 × 660 px** (confiance moyenne, bord inférieur conservé par précaution). Le résultat attendu après déduplication est **6 pages**.

## Comparaison avec la logique initiale

L’ancien réglage demandait 0,5 s de stabilité **plus** 0,25 s de marge : une vraie pause de 0,5 s ne pouvait pas satisfaire cette condition. Auto 2 tient compte de l’écart entre la pause réelle et les observations, puis confirme ses candidates.

Sur la paire de pages contenant les vrais chiffres 17 et 18, la différence moyenne globale est d’environ **0,000092**, bien inférieure à l’ancien seuil doublon de 0,006. Cela illustre pourquoi une moyenne seule peut supprimer une vraie différence. La vérification locale d’Auto 2 conserve cette paire, signalée comme ressemblante. Il s’agit d’un cas de test, pas d’une mesure de précision sur les vidéos de l’utilisateur.

## Vérifications statiques

- Syntaxe de tous les scripts analysée ; imports et fichiers correspondants vérifiés.
- Identifiants HTML uniques et références de `app.js` contrôlées.
- Valeurs recommandées cohérentes entre l’interface et le moteur.
- Manifest valide ; icônes PNG 192 × 192 et 512 × 512 vérifiées.
- Tous les modules utilisés par l’application inclus dans le cache `v2`.
- Chemins relatifs et résolution sous un sous-dossier GitHub Pages contrôlés.
- Aucun package.json, installation, build, Node.js ou dépendance CDN nécessaire.
- Aucun envoi de vidéo ou service distant de traitement dans le code.
- Revue des URL Blob, encodages séquentiels, verrouillage des contrôles, annulation, recadrage constant et limites mémoire.

Le module PDF binaire n’a pas changé : lors de la première livraison, son fichier réel de test a été lu strictement avec pypdf, avec deux JPEG décodables, ratios portrait/paysage préservés et table xref valide. Ses imports vers les modules modifiés ont été vérifiés pour Auto 2.

## Essais réels toujours nécessaires

Sur l’iPad et avec des enregistrements représentatifs, vérifier :

1. Import depuis Fichiers et Photos, codecs MP4/MOV, orientation et durée.
2. Arrêts de 0,5 s, menus, zooms, corrections de scroll, pages très semblables et retours en arrière.
3. Correspondance visuelle entre le recadrage proposé, les pages originales et les JPEG exportés.
4. Netteté des caractères, nombre de pages attendu, éventuels doublons restants et faux rejets.
5. Durée de traitement et mémoire sur un enregistrement long à haute résolution.
6. Partage/téléchargement du PDF, arrêt de l’analyse, fermeture de Safari, installation sur l’écran d’accueil et réouverture hors connexion.

Aucun taux de réussite universel n’est revendiqué. Le moteur ne comprend pas sémantiquement ce qu’est une page et ne peut pas reconstituer les parties hors écran. Les cas incertains sont conservés ou signalés pour vérification.
