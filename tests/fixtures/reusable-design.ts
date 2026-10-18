import type { DesignTheme } from "../../src/render/design.ts";
export const reusableTheme: DesignTheme = {
  background: "#fafafa",
  color: "#303030",
  accent: "#b11562",
  fontFamily: "Fira Sans, Arial, sans-serif",
  styles: {
    title: { fontSize: 40, color: "#ffffff" },
    heading: { fontSize: 30, color: "#174941" },
    body: { fontSize: 24, lineHeight: 1.3 },
    code: {
      fontSize: 20,
      fontFamily: "Fira Code, monospace",
      color: "#234567",
    },
    card: { fill: "#eef8f6", stroke: "#227969", radius: 12, color: "#283b37" },
  },
  namedStyles: {
    question: {
      target: "card",
      properties: { fill: "#fff0f6", stroke: "#b11562", color: "#66334b" },
    },
    caption: {
      target: "text",
      properties: { fontSize: 18, color: "#777777", align: "center" },
    },
    snippet: { target: "code", properties: { color: "#335577", fontSize: 18 } },
  },
  variants: {
    content: {
      titleFrame: { x: 60, y: 30, w: 1160, h: 80 },
      contentFrame: { x: 60, y: 170, w: 1160, h: 500 },
      decorations: [{
        id: "title-bar",
        x: 0,
        y: 0,
        w: 1280,
        h: 130,
        fill: "#263b3b",
      }],
    },
    section: {
      background: "#b11562",
      title: { fontSize: 58, align: "center", valign: "middle" },
      titleFrame: { x: 80, y: 220, w: 1120, h: 220 },
      contentFrame: { x: 80, y: 500, w: 1120, h: 160 },
    },
  },
  defaultVariant: "content",
};
