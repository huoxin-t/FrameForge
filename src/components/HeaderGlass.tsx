/**
 * 顶部玻璃纹理。
 *
 * 来源：docs/顶部.md 的 DistortedGlass。原组件使用 styled-jsx，
 * 这里改成普通 React + 全局 CSS，并把固定宽度/Next.js 依赖去掉，
 * 让它铺满 AppShell header。
 */
export function HeaderGlass() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      <svg className="absolute size-0" focusable="false">
        <defs>
          <filter id="frameforge-header-glass">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.12 0.12"
              numOctaves="1"
              result="warp"
            />
            <feDisplacementMap
              xChannelSelector="R"
              yChannelSelector="G"
              scale="30"
              in="SourceGraphic"
              in2="warp"
            />
          </filter>
        </defs>
      </svg>
      <div className="header-glass-texture absolute inset-0" />
      <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />
    </div>
  );
}
