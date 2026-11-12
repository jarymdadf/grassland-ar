# Grassland biodiversity – AR experience

Research prototype for an experimental study on augmented reality (AR) and consumers' valuation of grassland biodiversity in milk products (Studies II/III).

Live: https://jarymdadf.github.io/grassland-ar/

## What it does
The approved 2D prototype pictures (levels 1, 3 and 5) are turned into a 3D grassland placed in the real room, covering 180° in front of the participant. Outside that half, the room is seen through the camera; the scene fades out softly towards its side edges and towards the top of the sky. The level bar (1, 3, 5), badge, markers, cards, counter and tap log are unchanged from prototype v2.2.

## Display modes (chosen automatically after tapping Start)
1. `xr8` – 8th Wall engine world tracking: camera image, turning and walking (6DoF). iPhone Safari and Android Chrome.
2. `webxr` – Android's own AR (WebXR immersive-ar, 6DoF), used if the 8th Wall engine is not available.
3. `orient` – camera image and device orientation: turning only (3DoF). Last AR fallback.
4. `preview` – no camera; drag to look around. The view stops at the edge of the scene.

The mode that ran is written into the tap log (researcher view: tap the "explored" counter three times).

Test options in the address: `?mode=preview` (or `xr8`, `webxr`, `orient`) forces a mode; `?h=1.35` sets the device height above the floor in metres (default 1.35); `?scale=absolute` uses 8th Wall's absolute scale.

## Full screen
- Android: tapping Start switches to full screen and landscape.
- iPhone: Safari does not allow web pages to go full screen. Open it as a Home Screen web app: Share → Add to Home Screen → open "Grassland" from the Home Screen.

## Files
- `index.html`, `styles.css`, `app3d.js` – the experience
- `manifest.webmanifest`, `icons/` – Home Screen web app
- `assets/` – pictures, species images and scene data
- `lib/three.module.min.js` – three.js 0.160.0 (MIT licence)

## Third-party software
- AR tracking: 8th Wall Engine (distributed engine binary), © 2026 Niantic Spatial, Inc. Loaded from https://cdn.jsdelivr.net/npm/@8thwall/engine-binary@1/dist/xr.js and used under the XR Engine License Agreement: https://github.com/8thwall/engine/blob/main/LICENSE. Provided "as is", without warranty. This project is not connected with or endorsed by Niantic Spatial.
- three.js 0.160.0, © three.js authors, MIT licence.
