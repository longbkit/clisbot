const web = "packages/website/public/";
const store = "fastlane/metadata/android/en-US/images/phoneScreenshots/";
export const captureTargets = [
  {
    file: "hero-mockup.png",
    view: "desktop",
    width: 2048,
    height: 1233,
    targets: [web + "hero-mockup.png"],
  },
  {
    file: "homepage-hero.png",
    view: "desktop",
    width: 2400,
    height: 1442,
    targets: [web + "homepage-hero.png"],
  },
  {
    file: "mobile-mockup.png",
    view: "mobile",
    width: 2048,
    height: 1239,
    targets: [web + "mobile-mockup.png"],
  },
  {
    file: "iphone-mockup-left.png",
    view: "phone-1",
    width: 1857,
    height: 3096,
    targets: [web + "iphone-mockup-left.png"],
  },
];

for (const n of [1, 2, 3]) {
  captureTargets.push({
    file: `phone-${n}.png`,
    view: `phone-${n}`,
    width: 1206,
    height: 2622,
    targets: [web + `phone-${n}.png`],
  });
  for (const size of [320, 480]) {
    captureTargets.push({
      file: `phone-${n}-${size}.webp`,
      view: `phone-${n}`,
      width: size,
      height: (size * 874) / 402,
      targets: [web + `phone-${n}-${size}.webp`],
    });
  }
  captureTargets.push({
    file: `android-screen-${n}.png`,
    view: `android-${n}`,
    width: 1080,
    height: 2340,
    targets: [store + `${n}.png`],
  });
}
