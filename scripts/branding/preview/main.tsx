import React from "react";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "framer-motion";
import {
  MockupWindow,
  MobileChat,
  MobileDiff,
  MobileSidebar,
  PhoneFrame,
} from "../../../packages/website/src/components/mockup";
import "./preview.css";

const params = new URLSearchParams(location.search);
const view = params.get("view") ?? "desktop";
const width = Number(params.get("width") ?? 2048);
const height = Number(params.get("height") ?? 1233);
const phones = [
  { id: "workspace", Screen: MobileSidebar },
  { id: "chat", Screen: MobileChat },
  { id: "diff", Screen: MobileDiff },
];
const mobileStyle = {
  transform: `scale(${Math.min((width - 128) / 1350, (height - 100) / 874)})`,
};
const phoneStyle = { transform: `scale(${Math.min(width / 402, height / 874)})` };
const desktopStyle = {
  transform: `scale(${Math.min((width - 100) / 1440, (height - 100) / 826)})`,
};
const captureStyle = { width, height };

function Phone({ index, android = false }: { index: number; android?: boolean }) {
  const { Screen } = phones[index];
  return android ? (
    <div className="android-screen">
      <Screen />
    </div>
  ) : (
    <PhoneFrame time="9:41">
      <Screen />
    </PhoneFrame>
  );
}

function Frame() {
  if (view === "mobile") {
    return (
      <div className="mobile-row" style={mobileStyle}>
        {phones.map((phone, i) => (
          <div key={phone.id} className="phone">
            <Phone index={i} />
          </div>
        ))}
      </div>
    );
  }
  if (view.startsWith("phone-") || view.startsWith("android-")) {
    const android = view.startsWith("android-");
    return (
      <div className="phone" style={phoneStyle}>
        <Phone index={Number(view.split("-")[1]) - 1} android={android} />
      </div>
    );
  }
  return (
    <div className="desktop-window" style={desktopStyle}>
      <MockupWindow state="build" />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <MotionConfig reducedMotion="always">
    <main id="capture" style={captureStyle}>
      <Frame />
    </main>
  </MotionConfig>,
);
