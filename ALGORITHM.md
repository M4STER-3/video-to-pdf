# Moteur Auto 3

Ce moteur est une analyse visuelle déterministe en JavaScript. Il ne fait ni OCR, ni reconnaissance sémantique, ni reconstruction des portions hors écran. Les scores sont des heuristiques, pas des probabilités mesurées.

## Déroulement

1. **Recadrage sur plusieurs observations.** Jusqu’à onze images à 320 px sur le grand côté sont réparties sur la durée de la vidéo. Les contrastes persistants et étendus entre deux zones sont cherchés à plusieurs distances, avec une direction cohérente. Cela limite la confusion avec une règle de tableau ou un titre. Les limites latérales doivent être appariées. Les bords qui excluraient une zone présentant une activité temporelle significative sont abandonnés. Une marge de sécurité reste autour du document ; une région trop petite ou sans limites fiables entraîne un retour à l’image entière. La méthode fonctionne avec des pages claires ou sombres lorsque leur fond contraste avec l’interface.
   Une seconde méthode recherche les ombres fines sur une image médiane temporelle : paire de côtés longs, bandes extérieures uniformes, haut et bas indépendants. Les proportions mesurées sont conservées sans ratio A4 forcé. L’ancien secours fondé uniquement sur le plus fort gradient moyen est retiré : il pouvait sélectionner une ligne de tableau et garder le bas de l’écran. Un badge gris rempli, répété sur au moins cinq observations et entouré de blanc, peut être exclu des pixels exportés ; chaque capture vérifie à nouveau sa présence. Un pied de page non uniforme ou un numéro nu n’est pas effacé.
2. **Calibration bornée.** Six paires rapprochées, à 192 px, fournissent une estimation du bruit visuel. Un quantile bas détermine un seuil, borné pour éviter qu’une vidéo entièrement en mouvement ne soit prise comme référence de stabilité. Le réglage utilisateur multiplie cette référence, bornée entre 0,014 et 0,022 avant multiplication. Un petit changement doit être concentré spatialement ; des erreurs de compression réparties dans le texte ne suffisent plus à interrompre la pause.
3. **Recherche temporelle.** Huit observations par seconde par défaut, à 384 px sur le grand côté, sans déformer les proportions. Des observations intermédiaires sont ajoutées aux transitions entre mouvement et arrêt. Seules des métadonnées d’intervalles et quelques représentantes sont retenues.
4. **Confirmation et netteté.** Jusqu’à huit candidates par intervalle sont examinées à 640 px. Au moins deux observations voisines doivent être compatibles avec la stabilité. Le score favorise la netteté des contours et légèrement le centre de la pause. Une candidate entièrement vide ou sans stabilité confirmée n’est pas extraite.
5. **Vérification des doublons.** Des signatures compactes présélectionnent jusqu’à cinq pages proches déjà retenues. Le moteur relit leurs timestamps et vérifie les images jusqu’à 1280 px, avec des cellules de 16 × 16 pixels pour préserver les petites différences. Une très petite translation peut être compensée, à condition qu’aucun détail nouveau n’apparaisse dans l’intérieur ou la bordure entrante. Les ressemblances non confirmées restent dans la sélection avec un signalement. Une seconde comparaison lissée distingue des variations de rendu réparties d’une modification localisée. Un assombrissement global est ajusté puis confirmé sur les pixels pour reconnaître une feuille masquée par un panneau système. La meilleure capture remplace une version moins nette à la même position dans la sélection.
6. **Extraction originale.** Chaque candidate conservée est relue au timestamp choisi et capturée aux dimensions originales du recadrage. Les doublons ne sont encodés à nouveau que si une version plus nette doit remplacer la précédente. Le PDF conserve ces dimensions et le ratio, quelle que soit l’orientation.

## Mouvement et détails

`motionMetrics` combine luminance, contours, 36 zones et de petites cellules de détail. Le poids des zones texturées empêche les grandes marges vides de masquer tout mouvement. Un appariement borné estime le déplacement entre images. Une direction répétée et une comparaison avec l’ancre de l’intervalle évitent de classer un scroll lent comme un arrêt. Un déplacement isolé d’un pixel peut être toléré ; une dérive persistante termine l’intervalle.

Une animation localisée en bordure n’interrompt pas immédiatement la pause. Un changement local qui persiste est cependant confirmé et ouvre une nouvelle candidate à son timestamp initial : cela protège notamment les numéros de page. Un menu peut ressembler à un changement légitime ; ces cas restent soumis à vérification.

## Pourquoi 0,5 seconde ne signifie pas une capture périodique

À huit observations par seconde, une pause réelle de 0,5 s couvre normalement plusieurs observations dont l’écart observé est plus court que la pause réelle. Le réglage recommandé exige 0,30 s de stabilité mesurée et réserve 0,06 s après mouvement. Un plancher de 0,24 s mesuré empêche les gels accidentels de devenir des pages. Les tests couvrent douze décalages de la pause par rapport à l’échantillonnage. Les pauses limites de 0,24 à 0,36 s peuvent rester candidates mais sont signalées.

Cette configuration est un objectif de détection, pas une garantie pour tous les codecs, contenus, appareils ou mouvements. Une pause de dix secondes n’engendre pas vingt captures ; elle forme un intervalle dont une seule représentante est choisie. Des intervalles séparés montrant à nouveau le même contenu passent par la déduplication.

## Mémoire et interruptions

- Les samplers de 192, 384, 640 et 1280 px réutilisent leur canvas. Ils sont explicitement libérés, y compris si une création ultérieure ou une capture échoue.
- Les frames originales ne sont pas accumulées. Un intervalle conserve au plus huit représentantes à résolution intermédiaire pendant sa vérification.
- L’index de pages retenues conserve seulement les signatures, identifiants et timestamps, pas des copies de toutes les grandes images.
- Les seeks sont séquentiels, avec contrôle du décodage, délai maximal, gestion des erreurs et retrait des écouteurs. L’annulation est vérifiée entre opérations et pendant les seeks. Un encodage JPEG déjà demandé au navigateur peut devoir se terminer avant que l’annulation soit prise en compte.
- La collecte d’intervalles est bornée à 2 500 candidats ; les images finales à 200 pages / 160 Mo. Ces plafonds préventifs ne garantissent pas que tous les iPad disposent d’assez de mémoire.
- Une interruption pendant la recherche peut ne laisser aucune capture, car la sélection détaillée intervient ensuite. Pendant l’extraction, les pages déjà acceptées restent disponibles. Une réanalyse explicitement lancée remplace la sélection précédente.

## Fichiers

| Fichier | Responsabilité |
| --- | --- |
| `vision.js` | Descripteurs, déplacement, différences locales, stabilité et doublons |
| `auto-crop.js` | Recherche de limites cohérentes et choix prudent du cadre |
| `video-analyzer.js` | Seek, samplers et capture JPEG |
| `analysis-engine.js` | Calibration, recherche, vérification, extraction et annulation |
| `app.js` | Parcours automatique, contrôle de la sélection, mémoire et export |
| `tests/` | Cas déterministes, glyphes rastérisés et interactions simulées |

## Limites non résolues par cette version

L’algorithme ne sait pas prouver qu’un rectangle est une page de document, distinguer tous les menus de toutes les vraies modifications, reconnaître chaque caractère ni reconstituer un document qui défile sans pause. Un vrai changement plus petit que la résolution d’analyse peut être manqué. Le recadrage peut garder de l’interface par prudence. Une vérification visuelle finale reste nécessaire.
