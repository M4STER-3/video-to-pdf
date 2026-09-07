# Validation Auto 3 — 7 septembre 2026

## Ce qui a été exécuté

Le moteur JavaScript de production a été exécuté dans V8 sur les **images réelles décodées de `Unknown.mp4`**, et non sur une sélection manuelle de six captures. Le nombre attendu ne participe à aucune décision du moteur.

Pour ce test local, FFmpeg décode les 279 images (960 × 720, 30 images/s, 9,3 secondes). Pillow applique le même rectangle et les dimensions des samplers avec un rééchantillonnage bilinéaire. Des adaptateurs remplacent uniquement les seeks, l’accès au canvas et l’encodage JPEG ; les calculs JavaScript de recadrage, stabilité, sélection et déduplication sont ceux de l’application. Le harnais attend la lecture disque asynchrone des images ; ce mécanisme de test n’est pas livré dans l’application. Aucun extrait de la vidéo ni de ses images n’est envoyé au dépôt.

**Ce n’est pas un test du décodage Safari, de son canvas ni d’un iPad physique.** Le précédent compte rendu confondait six pages repérées visuellement avec six pages produites automatiquement. Cette version corrige cette distinction.

## Résultat de la vidéo fournie

- Ancien moteur reproduit avec le cadre précédent : trois captures dans le harnais local, dont une assombrie ; l’utilisateur signalait deux captures dans Safari. Les deux parcours manquaient plusieurs feuilles.
- Nouveau moteur : **9 intervalles candidats, 6 feuilles uniques, 3 captures redondantes écartées**, sans nombre imposé.
- Cadre : **x = 249, y = 45, largeur = 459, hauteur = 654 pixels**. Les quatre bords de la feuille sont détectés ; le format portrait mesuré est conservé.
- Le compteur gris du lecteur est détecté puis confirmé dans chacune des six captures avant nettoyage. Les notes de bas de page et les numéros non encadrés sont protégés par un test négatif.
- Les doublons utiles permettent de remplacer une capture par son rendu plus net sans changer l’ordre de première apparition des feuilles.

| Position finale | Capture choisie | Observation |
| --- | ---: | --- |
| 1 | 5,4758 s | Version plus nette de la feuille déjà vue à 1,1008 s |
| 2 | 3,4531 s | Version plus nette de la même pause à 3,1000 s |
| 3 | 4,4254 s | Feuille distincte |
| 4 | 6,4937 s | Feuille distincte, pause brève |
| 5 | 7,3042 s | Feuille distincte, pause brève |
| 6 | 8,2675 s | Feuille nette ; version assombrie à 9,0415 s écartée |

Le module PDF réel `lib/image-pdf.js` a assemblé les six JPEG obtenus à ces timestamps. Lecture stricte avec pypdf : six pages, un JPEG décodable par page, proportions 459/654 conservées. Le PDF a été rendu avec MuPDF et les six pages inspectées visuellement. Ce PDF de contrôle valide le writer et la sélection ; son encodage JPEG est réalisé par l’adaptateur local, pas par Safari.

## Régressions

Les résultats nommés se trouvent dans `tests/results.json`. Les tests couvrent les pauses de 0,5 seconde avec douze décalages, les gels trop courts, le défilement continu, les modifications de caractères, la compression répartie, l’assombrissement, les feuilles avec ombres, le nettoyage prudent d’un badge, les annulations, la mémoire et les interactions simulées. Les tests négatifs de cadrage utilisent au moins cinq images pour exercer également le nouveau détecteur.

La page `tests/index.html` exécute les tests sans installation. Les interactions utilisent un DOM simulé et ne prouvent pas un fonctionnement tactile sur iPad physique.

## Mise à jour et limites

Le service worker utilise un nouveau cache `v3-pages-20260907`, contrairement à la précédente correction qui avait laissé `v2` inchangé. Une session déjà ouverte conserve ses fichiers ; fermer les fenêtres après un passage en ligne permet d’activer la mise à jour sans interrompre une extraction.

Le traitement reste statique et local, sans installation, dépendance distante ni backend. Les originaux hors écran ne peuvent pas être reconstruits. La qualité reste limitée par la vidéo ; des corrections minuscules accompagnées de beaucoup de bruit ou un lecteur très différent peuvent encore demander une vérification. Aucun taux de réussite universel ni validation Safari physique n’est revendiqué.
