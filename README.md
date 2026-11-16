# Grassland biodiversity – AR experience

Research prototype for an experiment on how augmented reality (AR) affects consumers' understanding and valuation of biodiversity in food products. Test product: fresh milk from grassland-based dairy production (Germany).

| | Link |
|---|---|
| **Last AR version** | https://jarymdadf.github.io/grassland-ar/ |
| **3D version** (no camera) | https://jarymdadf.github.io/grassland-ar/3d/ |

## What the experiment is about
Biodiversity is a credence attribute: consumers cannot see or verify it in the product, so they depend on how it is communicated on the label. A label score such as "Biodiversity 3/5" tells little about what is actually happening on the farm.

This prototype adds a visual layer to a biodiversity label. Participants see the grassland behind the product and can compare it with lower and higher biodiversity levels. The study tests whether this format, compared with the label alone, changes how consumers evaluate the product (Study II) and how much they are willing to pay for biodiversity (Study III, choice experiment). Participants are assigned at random to one of the two formats, in a laboratory session.

## What participants see
A grassland that belongs to the milk product, rated on a biodiversity label from 1 (low) to 5 (high). The product is level 3, and the experience opens at level 3. Participants can switch to level 1 and level 5 for comparison; levels 2 and 4 are shown but cannot be selected.

| Level | Grassland | Points to tap |
|---|---|---|
| 1 – Low | Frequently mown, no flowers | Mown area, no field margin, hedgerow |
| **3 – Moderate (this product)** | Mown field with a narrow flower-rich margin | Bee, butterfly, meadow flowers, field margin, hedgerow |
| 5 – Very high | Wide unmown, flower-rich strip | Bee, butterfly, grassland bird, meadow flowers, flower strip, field margin, hedgerow |

Tapping a point opens a short card: what the species or element is, and which farming practice it is linked to. When the level changes, the landscape, flowers and animals change with it. A short sentence explains the level.

## Difference between the AR and the 3D version
| | AR version | 3D version |
|---|---|---|
| Where the grassland appears | In the real room, through the device camera | On the screen only |
| How to look around | Turn and walk with the device | Drag with the finger or mouse (arrow keys on a computer) |
| Scene | 180° in front of the participant; behind and beside it, the real room stays visible | The same landscape, viewed from a fixed point |
| Devices | Phone or tablet with camera | Any phone, tablet or computer |
| Purpose | The treatment in the experiment | Showing the content to partners and colleagues, and a fallback if the camera cannot be used |

Both versions show the same landscape, species, texts and levels.

## How to use
**AR version**
1. Open the link on a phone or tablet (iPhone: Safari; Android: Chrome) and turn the device sideways.
2. Stand where there is free space in front of you. Hold the device at chest height, pointing slightly down at the floor, and tap **Start**.
3. Allow camera and motion access. Move the device slowly from side to side until the grassland appears.
4. Turn left and right to find the points; arrows at the screen edges show where unexplored points are. Use the level bar at the bottom to compare levels.

**3D version**: open the link on any device and drag to look around.

**Tips**
- If an older version appears, close the browser tab completely and open the link again.
- iPhone: Safari does not allow full screen for web pages. For full screen, tap Share → *Add to Home Screen*, then open "Grassland" from the Home Screen.

## Status
Working prototype, currently being tested on devices (iPhone and Android tablet). The species list, the points per level and the card texts are placeholders until they are confirmed by grassland specialists. Data recording for the study sessions is still to be added.

## Credits
- AR tracking: 8th Wall Engine, © 2026 Niantic Spatial, Inc., used under the [XR Engine License Agreement](https://github.com/8thwall/engine/blob/main/LICENSE), provided without warranty. This project is not connected with or endorsed by Niantic Spatial.
- 3D graphics: three.js (MIT licence).
- Image enhancement of the distant landscape: Real-ESRGAN (Wang et al., 2021; BSD-3-Clause licence).
