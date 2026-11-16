# Grassland biodiversity – AR experience

This is the prototype I am building for the experiment on augmented reality (AR) and biodiversity in food. The test product is fresh milk from grassland-based dairy farming in Germany.

| | Link |
|---|---|
| **Last AR version** | https://jarymdadf.github.io/grassland-ar/ |
| **3D version** (no camera) | https://jarymdadf.github.io/grassland-ar/3d/ |

## What the experiment is about
Consumers cannot see or check biodiversity in the milk they buy. They only know what the label tells them, and a score like "Biodiversity 3/5" says very little about what is actually happening on the farm.

So we bring the grassland behind the label to the consumer. With the AR layer, participants see the meadow the milk comes from, and can compare it with a poorer and a richer one. We then look at two things: whether this changes how people judge the product (Study II), and whether it changes how much they are willing to pay for biodiversity (Study III, a choice experiment). In the lab sessions, each participant is randomly given either the label alone or the label with the AR layer.

## What participants see
The grassland the milk comes from, rated on the biodiversity label from 1 (low) to 5 (high). The product is level 3, so the experience opens there. Participants can switch to level 1 or level 5 to compare. Levels 2 and 4 are visible on the scale but cannot be selected.

| Level | The grassland | Points to tap |
|---|---|---|
| 1 – Low | Mown often, no flowers | Mown area, no field margin, hedgerow |
| **3 – Moderate (the product)** | Mown field with a narrow strip of flowers along the edge | Bee, butterfly, meadow flowers, field margin, hedgerow |
| 5 – Very high | A wide unmown strip full of flowers | Bee, butterfly, grassland bird, meadow flowers, flower strip, field margin, hedgerow |

Each point opens a short card explaining what it is and which farming practice it depends on. When participants switch level, the meadow, the flowers and the animals change with it, and one sentence sums up the level.

## AR version and 3D version
| | AR version | 3D version |
|---|---|---|
| Where the grassland appears | In the room, through the camera of the phone or tablet | On the screen only |
| How you look around | By turning and walking with the device | By dragging with your finger or mouse (or the arrow keys) |
| What you see | The meadow spread out in front of you; the room stays visible around it | The same meadow, from one fixed spot |
| Devices | Phone or tablet with a camera | Any phone, tablet or computer |
| What we use it for | This is what participants get in the experiment | For us to see what the content looks like |

The landscape, animals, texts and levels are the same in both.

## How to try it
**AR version**
1. Open the link on a phone or tablet (Safari on iPhone, Chrome on Android) and hold it sideways.
2. Find a spot with some free space in front of you. Hold the device at chest height, tilted a little towards the floor, and tap **Start**.
3. Allow the camera and motion access. Move the device slowly left and right until the meadow appears.
4. Turn around to find the points; the arrows on the sides of the screen show where the ones you have not opened yet are. Use the level bar at the bottom to compare levels.

**3D version**: just open the link and drag to look around.

**Good to know**
- If you see an older version, close the tab completely and open the link again.
- On iPhone, Safari cannot go full screen. To get full screen, tap Share → *Add to Home Screen*, then open "Grassland" from your Home Screen.

## Where things stand
The prototype works, and I am now testing it on an iPhone and on the Android tablet I will use in the lab. The species, the points per level and the card texts are still provisional: they will be checked by grassland specialists and ecologists, or by us. Recording the participants' data during the sessions is the next thing I will add.

## Credits
- AR tracking: 8th Wall Engine, © 2026 Niantic Spatial, Inc., used under the [XR Engine License Agreement](https://github.com/8thwall/engine/blob/main/LICENSE), without warranty. This project is not connected with or endorsed by Niantic Spatial.
- 3D graphics: three.js (MIT licence).
- Sharpening of the distant landscape: Real-ESRGAN (Wang et al., 2021; BSD-3-Clause licence).
