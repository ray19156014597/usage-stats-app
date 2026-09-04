/**
 * usage-stats-app — primitives shim.
 *
 * Minimal stand-in for `@deepseek-ai/dsh-client-ui-primitives`: the six icon
 * components and the Tooltip wrapper the panel imports. Plain JS + SVG, no
 * JSX. Exposed as `window.USG_PRIMITIVES` for the boot require shim.
 */
(function () {
  "use strict";
  var React = window.React;
  var h = React.createElement;

  function Svg({ size, children, viewBox }) {
    return h("svg", {
      width: size || 16,
      height: size || 16,
      viewBox: viewBox || "0 0 16 16",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.6,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      "aria-hidden": true
    }, children);
  }

  function IconDataOutline16(props) {
    return h(Svg, { size: props.size, viewBox: "0 0 16 16" },
      h("path", { d: "M3 10.5V13" }),
      h("path", { d: "M7 2.5V13" }),
      h("path", { d: "M11 6.5V13" }),
      h("path", { d: "M2 13.5h12" })
    );
  }

  function IconRefreshOutline14(props) {
    return h(Svg, { size: props.size, viewBox: "0 0 16 16" },
      h("path", { d: "M13.2 8a5.2 5.2 0 1 1-1.6-3.8" }),
      h("path", { d: "M13.2 1.8v2.9h-2.9" })
    );
  }

  function IconSettingsOutline14(props) {
    return h(Svg, { size: props.size, viewBox: "0 0 16 16" },
      h("path", { d: "M2.5 4.5h11" }),
      h("path", { d: "M2.5 8h11" }),
      h("path", { d: "M2.5 11.5h11" }),
      h("circle", { cx: 6, cy: 4.5, r: 1.9, fill: "var(--usg-blue, currentColor)", stroke: "none" }),
      h("circle", { cx: 10.5, cy: 8, r: 1.9, fill: "var(--usg-blue, currentColor)", stroke: "none" }),
      h("circle", { cx: 5.5, cy: 11.5, r: 1.9, fill: "var(--usg-blue, currentColor)", stroke: "none" })
    );
  }

  function IconCloseOutline16(props) {
    return h(Svg, { size: props.size, viewBox: "0 0 16 16" },
      h("path", { d: "M4 4l8 8" }),
      h("path", { d: "M12 4l-8 8" })
    );
  }

  function IconChevronLeftOutline14(props) {
    return h(Svg, { size: props.size, viewBox: "0 0 16 16" },
      h("path", { d: "M10 3.5L5.5 8l4.5 4.5" })
    );
  }

  function IconChevronRightOutline14(props) {
    return h(Svg, { size: props.size, viewBox: "0 0 16 16" },
      h("path", { d: "M6 3.5L10.5 8 6 12.5" })
    );
  }

  /** Pushpin (filled, reads well at 14px) — the "keep on top" toggle icon. */
  function IconPinOutline14(props) {
    return h("svg", {
      width: props.size || 14,
      height: props.size || 14,
      viewBox: "0 0 24 24",
      fill: "currentColor",
      "aria-hidden": true
    },
      h("path", { d: "M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z" })
    );
  }

  /** Window caption: minimize. */
  function IconMinimizeOutline14(props) {
    return h(Svg, { size: props.size, viewBox: "0 0 16 16" },
      h("path", { d: "M3 8h10" })
    );
  }

  /** Window caption: maximize/restore toggle. */
  function IconMaximizeOutline14(props) {
    return h(Svg, { size: props.size, viewBox: "0 0 16 16" },
      h("rect", { x: 3.5, y: 3.5, width: 9, height: 9, rx: 1.5 })
    );
  }

  /** Simple hover tooltip: label appears above the wrapped element. */
  function Tooltip({ label, side, delayMs, children }) {
    if (label === void 0 || label === null || label === "") return h("span", null, children);
    return h("span", {
      className: "usg_tip",
      "data-tip": String(label),
      "data-side": side || "top"
    }, children);
  }

  window.USG_PRIMITIVES = {
    IconDataOutline16: IconDataOutline16,
    IconRefreshOutline14: IconRefreshOutline14,
    IconSettingsOutline14: IconSettingsOutline14,
    IconCloseOutline16: IconCloseOutline16,
    IconChevronLeftOutline14: IconChevronLeftOutline14,
    IconChevronRightOutline14: IconChevronRightOutline14,
    IconPinOutline14: IconPinOutline14,
    IconMinimizeOutline14: IconMinimizeOutline14,
    IconMaximizeOutline14: IconMaximizeOutline14,
    Tooltip: Tooltip
  };
})();
