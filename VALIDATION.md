# Vérifications de livraison — 7 septembre 2026

## Vérifications exécutées

| Point | Résultat et portée |
| --- | --- |
| Fichiers HTML, CSS et JavaScript | Présents ; syntaxe des cinq fichiers JavaScript analysée avec le moteur JavaScript V8, sans Node.js. |
| Références de l’interface | Identifiants HTML uniques et références JavaScript contrôlées ; tous les identifiants utilisés existent. |
| Chemins GitHub Pages | Références HTML, imports JavaScript, icônes et manifest vérifiés : chemins relatifs, fichiers présents. |
| PWA | Manifest JSON valide ; `start_url`, `scope` et `id` relatifs ; PNG vérifiés à 192 × 192 et 512 × 512. |
| Absence d’installation | Aucun package.json, gestionnaire de paquets, Node.js, build ou dépendance CDN dans le projet. |
| Stabilité | Tests exécutés sur séquences synthétiques : longue pause → une page ; deux pauses → deux pages ; scroll rapide et scroll lent continu → aucune ; pause trop brève → aucune ; léger tremblement → une page. |
| Doublons | Analyse exécutée avec vidéo/canvas simulés : parcours A → B → A produit deux pages ; seuil zéro produit trois pages. |
| Extraction | Dans le test simulé, timestamps choisis au milieu des pauses et dimensions du recadrage conservées (1200 × 1800). Les pixels réels d’une vidéo n’ont pas été testés. |
| Progression et annulation | Tests simulés : progression finale à 100 %, annulation pendant l’analyse et avant un seek, absence d’écouteurs restants après seek/annulation. |
| PDF | Le vrai module JavaScript a généré un PDF binaire avec deux vrais JPEG. Lecture stricte réussie avec pypdf, deux pages, ratios 1:2 et 2:1 exacts, images JPEG extraites et décodées aux dimensions d’origine, table xref valide. Le Blob a été simulé par un assemblage des mêmes octets. |

## Revue du code effectuée

- Import : filtrage des fichiers, métadonnées, délai maximal, message de codec incompatible, révocation des URL vidéo et annulation de l’ouverture.
- Lecture : seeks attendus et séquentiels, événements `seeked`/`loadeddata`, contrôle `readyState`, erreurs et délais maximaux. Aucun recours obligatoire à `requestVideoFrameCallback`, qui peut ne pas être déclenché sur une vidéo en pause.
- Recadrage : quatre bords avec Pointer Events et capture du pointeur, réglage au clavier, conversion vers `videoWidth`/`videoHeight`, même zone pour toutes les captures.
- Analyse : comparaison 64 × 64 en niveaux de gris, différence moyenne absolue, ancrage pour éviter le scroll lent, délai après mouvement, milieu des pauses, seuil distinct pour doublons.
- Mémoire : JPEG et petites miniatures ; pas de collection de frames brutes ; canvas libérés ; URL révoquées ; plafond de pages et de taille ; cinq suppressions restaurables maximum.
- Interface : verrouillage pendant les opérations, annulation, ajout manuel, suppression/restauration, boutons tactiles de réordonnancement, invalidation du PDF si les pages changent, messages lisibles.
- Export : date locale dans le nom, taille du PDF, téléchargement Blob, `navigator.share` avec `navigator.canShare` et téléchargement de secours.
- Hors connexion : cache des seuls fichiers applicatifs, URLs construites avec le scope, nettoyage limité aux caches de cette application, activation des mises à jour après fermeture des anciennes sessions.
- Confidentialité : aucun envoi de vidéo, aucun appel distant de traitement, aucun suivi, aucune clé ou secret.
- Accessibilité : labels, boutons sémantiques, focus visible, annonce de progression, mode clair/sombre et règles pour petits écrans.

## Vérifications restant à faire sur appareil réel

**Aucun navigateur ni iPad physique n’a été utilisé pour valider cette livraison.** L’environnement ne proposait pas de prévisualisation compatible avec ce projet statique sans installation. Les contrôles ci-dessus ne remplacent pas des essais réels du décodage et de l’interface.

Après activation de GitHub Pages, vérifier dans Safari sur l’iPad cible :

1. Importer un MP4/MOV depuis Fichiers puis Photos ; vérifier lecture, métadonnées et orientation.
2. Déplacer les quatre bords, avancer de 0,1 s et capturer une page ; vérifier visuellement la netteté et les limites du recadrage.
3. Analyser une vidéo avec pauses, scroll et retour en arrière ; comparer la sélection attendue, puis annuler une seconde analyse après réimport.
4. Supprimer, restaurer, déplacer et ajouter des pages ; générer les trois qualités PDF et vérifier l’ordre dans le fichier.
5. Télécharger puis partager le PDF dans Fichiers ; vérifier le comportement de secours si le partage est indisponible.
6. Ajouter à l’écran d’accueil ; attendre « Disponible hors connexion », fermer, activer le mode avion et rouvrir l’application.
7. Essayer un enregistrement représentatif de la durée et de la résolution habituelles, ainsi qu’un écran étroit et du texte agrandi.

Les limites connues et conseils mémoire figurent dans le README. La détection visuelle reste approximative : la vérification manuelle des pages est nécessaire.
