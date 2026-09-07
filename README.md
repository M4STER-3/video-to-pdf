# Vidéo en PDF — Auto 2

Transformez un enregistrement d’écran en PDF sur votre iPad. **Aucune installation, compilation, commande ou compte nécessaire. Tout est traité sur votre appareil.**

## Ouvrir le site

Dans GitHub : **Settings → Pages → Deploy from a branch → main → /(root) → Save**. Une fois la publication terminée, ouvrez [Vidéo en PDF](https://M4STER-3.github.io/video-to-pdf/) dans Safari.

Pour l’ajouter à l’iPad : **Partager → Sur l’écran d’accueil → Ajouter**.

**Mise à jour depuis la première version :** ouvrez le site avec Internet, puis fermez toutes ses fenêtres et l’application ajoutée à l’écran d’accueil. Rouvrez-le pour activer le nouveau cache. Sur un écran large, la marque **Auto 2** apparaît ; sur tous les écrans, l’accueil indique que le cadrage et l’analyse sont automatiques. Si l’ancienne version est encore affichée, refaites une fermeture complète après quelques secondes en ligne. Vos captures en cours ne sont pas conservées : exportez-les avant de fermer.

## Utilisation

1. **Choisissez la vidéo.** Le recadrage et l’analyse démarrent automatiquement.
2. **Vérifiez les pages.** Touchez une image pour l’agrandir ; « Voir à taille réelle » permet de contrôler les détails. Les pages incertaines sont signalées.
3. **Créez le PDF**, puis téléchargez-le ou partagez-le dans Fichiers.

Une pause réelle de **0,5 seconde est l’objectif pris en charge avec les réglages recommandés**. L’application observe plusieurs images pendant cette pause et choisit une seule candidate. Elle ne prend pas une photo toutes les 0,5 seconde : un plancher de stabilité mesurée empêche les gels très courts d’être retenus. Les doublons confirmés, y compris les retours en arrière et petites corrections de cadrage, sont écartés après vérification des détails. Les images entièrement vides et les candidates sans stabilité confirmée sont écartées.

## Corriger le résultat si nécessaire

- **Vérifier le cadrage** : ajustez les quatre bords ou recalculez le cadre. Appliquer le nouveau cadre relance l’analyse et remplace la sélection. « Revenir à la sélection » annule les changements de cadre non appliqués.
- **Ajouter une page manuellement** : déplacez le lecteur, puis ajoutez l’image. Une capture déjà présente au même timestamp n’est pas ajoutée une seconde fois.
- **Réorganiser** : utilisez les flèches sous les pages, compatibles tactile. La croix supprime une page ; les cinq dernières suppressions sont restaurables.
- **Doublons écartés** : examinez leur position dans la vidéo. Une image peut être récupérée si sa page correspondante a été supprimée.
- **Réglages avancés** : les valeurs recommandées visent les pauses de 0,5 seconde. Les augmenter peut faire manquer des pauses courtes. Un seuil doublon de zéro désactive leur suppression.

## Qualité, confidentialité et limites

- Les JPEG et le PDF conservent la résolution réelle de la zone recadrée. « Qualité maximale » réutilise les captures sans compression supplémentaire. Aucune option ne peut recréer du texte absent ou illisible dans la vidéo.
- **Aucune vidéo n’est envoyée à GitHub ou ailleurs.** Aucune API distante, aucun suivi et aucun CDN. GitHub Pages sert uniquement le code. Le PDF est produit par le module local `lib/image-pdf.js` sous licence MIT.
- Attendez **Disponible hors connexion** après le premier chargement. Le site peut ensuite se rouvrir hors ligne tant que Safari conserve son cache. Téléchargez auparavant toute vidéo stockée uniquement dans iCloud.
- Gardez le site au premier plan. L’application tente de maintenir l’écran allumé lorsque le navigateur le permet. Une suspension de Safari peut interrompre le traitement.
- MP4/MOV sont acceptés si le codec est décodable par Safari. Il n’y a aucune conversion vidéo. Les changements de dimensions en cours de vidéo demandent des extraits séparés.
- Le recadrage est automatique lorsqu’il existe des limites visuelles cohérentes. En cas de doute, il conserve une zone plus large et demande une vérification plutôt que couper du texte. Une zone visible n’est pas nécessairement une page complète ; aucune partie hors écran n’est reconstruite.
- Des menus immobiles, des changements très fins, un défilement sans véritable arrêt ou des documents sans bords distincts peuvent encore nécessiter une correction. Une ressemblance incertaine est conservée pour éviter de supprimer une vraie différence. L’absence absolue de doublons n’est donc pas garantie sur toute vidéo.
- Limite préventive : **200 pages ou 160 Mo d’images**, suppressions restaurables comprises. Safari peut atteindre sa limite mémoire avant cela. Utilisez plusieurs extraits pour les longues vidéos. Le traitement approfondi fait plus de lectures que la première version.
- Les captures sont temporaires : **exportez avant de fermer ou recharger**. Si le partage est indisponible, le téléchargement prend le relais.

## Vérification du projet

La livraison contient des tests du moteur, des caractères réellement rastérisés et des tests d’interactions avec un DOM simulé. Vous pouvez les exécuter depuis [la page de tests](./tests/index.html), sans installation. Ils ne constituent pas une validation sur iPad physique ou sur vos vidéos.

Voir [VALIDATION.md](./VALIDATION.md) pour les résultats et limites des essais, et [ALGORITHM.md](./ALGORITHM.md) pour le fonctionnement détaillé.

Pour une future mise à jour, changez la version du cache dans `service-worker.js` avec les fichiers modifiés. Aucun workflow personnalisé ni build n’est nécessaire.
