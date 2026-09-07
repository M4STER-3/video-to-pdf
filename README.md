# Vidéo en PDF

Une application pour transformer un enregistrement d’écran en pages PDF, sur iPad. **Aucune installation, aucune compilation, aucun terminal.**

## Ouvrir l’application

1. Dans ce dépôt GitHub, ouvrez **Settings → Pages**.
2. Sélectionnez **Deploy from a branch → main → /(root)**, puis **Save**.
3. Patientez jusqu’à ce que GitHub affiche le lien du site, puis ouvrez-le dans Safari : [Vidéo en PDF](https://M4STER-3.github.io/video-to-pdf/).
4. Sur iPad : menu **Partager → Sur l’écran d’accueil → Ajouter** (le libellé peut varier selon la version).

## Utilisation

Choisissez une vidéo → déplacez les bords du recadrage → lancez l’analyse → vérifiez les pages → créez et téléchargez ou partagez le PDF.

- Marquez une pause d’environ une seconde par page dans l’enregistrement.
- Les flèches sous les vignettes changent leur ordre au tactile. La croix supprime une page ; les cinq dernières suppressions peuvent être restaurées.
- Le lecteur permet d’ajouter une frame précise, avec le même recadrage.
- Les réglages avancés ajustent la détection. Un seuil de mouvement plus bas détecte davantage de petits mouvements. Un seuil doublon plus élevé retire davantage de pages ; zéro désactive cette suppression.
- Les trois qualités PDF conservent la résolution et le ratio des captures. « Maximale » réutilise leur JPEG sans nouvelle compression ; elle ne restaure pas les détails absents de la vidéo.

## Confidentialité et hors connexion

**La vidéo ne quitte jamais votre appareil.** Aucun compte, envoi, suivi, service distant ou bibliothèque CDN. GitHub Pages sert seulement l’application. Le petit module PDF est inclus dans `lib/image-pdf.js` sous licence MIT.

Attendez la mention **Disponible hors connexion** après le premier chargement. Vous pouvez ensuite rouvrir l’application sans réseau, tant que Safari conserve son cache. Les vidéos doivent être disponibles sur l’appareil ; un fichier uniquement dans iCloud doit être téléchargé auparavant. Les pages en cours ne sont pas sauvegardées après fermeture ou rechargement : exportez votre PDF avant de quitter.

## Limites à connaître

- Seuls les codecs que votre navigateur sait décoder sont acceptés ; MP4/MOV ne garantissent pas la compatibilité du codec. Aucune conversion vidéo n’est effectuée.
- Gardez l’application au premier plan et l’écran allumé. Safari peut suspendre une analyse en arrière-plan.
- La détection est visuelle et approximative. Défilements très lents, menus immobiles, petites animations ou pages très semblables peuvent demander une correction manuelle. Les retours à une ancienne page sont supprimés si elle est reconnue comme doublon.
- La limite préventive est de **200 pages ou 160 Mo d’images**, suppressions restaurables comprises. Safari peut manquer de mémoire avant cette limite sur certains appareils. Exportez en plusieurs parties avec des vidéos plus courtes si nécessaire.
- Les captures utilisent la résolution réelle du recadrage, sans agrandissement ni reconnaissance de texte. Une vidéo exceptionnellement grande peut dépasser les limites du canvas Safari.
- Si le partage n’est pas pris en charge, utilisez le téléchargement. Selon Safari, le PDF peut s’ouvrir dans un aperçu ; utilisez alors son menu Partager pour l’enregistrer dans Fichiers.
- Le fonctionnement sur un iPad physique doit être vérifié avec votre version de Safari et vos vidéos ; les vérifications de développement sont décrites dans `VALIDATION.md`.

## Fichiers

`index.html` et `styles.css` : interface. `app.js` : interactions et gestion mémoire. `video-analyzer.js` : lecture, capture, stabilité et doublons. `pdf-generator.js` et `lib/image-pdf.js` : PDF local. Manifest, icônes et service worker : installation sur l’écran d’accueil et cache hors connexion.

Pour une mise à jour du code, augmentez la version `v1` dans `service-worker.js`. Fermez toutes les fenêtres de l’application puis rouvrez-la pour activer la nouvelle version. Aucun workflow personnalisé n’est nécessaire.
