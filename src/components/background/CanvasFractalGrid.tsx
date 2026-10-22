/**
 * 动态点阵背景。
 *
 * 来源：docs/UI.md 中的 CanvasFractalGrid。当前项目为深色工作台，
 * 因此把点阵改为 screen 混合，并降低渐变透明度，避免盖住文字和控件。
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { motion, useAnimation } from 'motion/react';

interface GradientStop {
  color: string;
  position: number;
}

interface GradientType {
  stops: GradientStop[];
  centerX: number;
  centerY: number;
}

interface CanvasFractalGridProps {
  dotSize?: number;
  dotSpacing?: number;
  dotOpacity?: number;
  gradientAnimationDuration?: number;
  waveIntensity?: number;
  waveRadius?: number;
  gradients?: GradientType[];
  dotColor?: string;
  glowColor?: string;
  enableNoise?: boolean;
  noiseOpacity?: number;
  enableMouseGlow?: boolean;
  initialPerformance?: 'low' | 'medium' | 'high';
  enableGradient?: boolean;
  gradientOpacity?: number;
}

const NoiseSVG = React.memo(() => (
  <svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
    <filter id="frameforge-background-noise">
      <feTurbulence
        type="fractalNoise"
        baseFrequency="0.65"
        numOctaves="3"
        stitchTiles="stitch"
      />
    </filter>
    <rect
      width="100%"
      height="100%"
      filter="url(#frameforge-background-noise)"
    />
  </svg>
));

NoiseSVG.displayName = 'NoiseSVG';

function NoiseOverlay({ opacity }: { opacity: number }) {
  return (
    <div
      className="absolute inset-0 h-full w-full mix-blend-overlay"
      style={{ opacity }}
    >
      <NoiseSVG />
    </div>
  );
}

function useResponsive() {
  const [windowSize, setWindowSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const handleResize = () => {
      setWindowSize({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return {
    isMobile: windowSize.width < 768,
    isTablet: windowSize.width >= 768 && windowSize.width < 1024,
  };
}

function usePerformance(
  initialPerformance: 'low' | 'medium' | 'high' = 'medium',
) {
  const [performance, setPerformance] = useState(initialPerformance);
  const [fps, setFps] = useState(60);

  useEffect(() => {
    let frameCount = 0;
    let lastTime = globalThis.performance.now();
    let frameId = 0;

    const measureFps = (time: number) => {
      frameCount += 1;
      if (time - lastTime > 1000) {
        setFps(Math.round((frameCount * 1000) / (time - lastTime)));
        frameCount = 0;
        lastTime = time;
      }
      frameId = requestAnimationFrame(measureFps);
    };

    frameId = requestAnimationFrame(measureFps);
    return () => cancelAnimationFrame(frameId);
  }, []);

  useEffect(() => {
    if (fps < 30 && performance !== 'low') {
      setPerformance('low');
    } else if (fps >= 30 && fps < 50 && performance !== 'medium') {
      setPerformance('medium');
    } else if (fps >= 50 && performance !== 'high') {
      setPerformance('high');
    }
  }, [fps, performance]);

  return performance;
}

function Gradient({
  gradients,
  animationDuration,
  opacity,
}: {
  gradients: GradientType[];
  animationDuration: number;
  opacity: number;
}) {
  const controls = useAnimation();

  useEffect(() => {
    void controls.start({
      background: gradients.map(
        (gradient) =>
          `radial-gradient(circle at ${gradient.centerX}% ${gradient.centerY}%, ${gradient.stops
            .map((stop) => `${stop.color} ${stop.position}%`)
            .join(', ')})`,
      ),
      transition: {
        duration: animationDuration,
        repeat: Infinity,
        repeatType: 'reverse',
        ease: 'linear',
      },
    });
  }, [animationDuration, controls, gradients]);

  return (
    <motion.div
      className="absolute inset-0 h-full w-full mix-blend-screen"
      style={{ opacity }}
      animate={controls}
    />
  );
}

function DotCanvas({
  dotSize,
  dotSpacing,
  dotOpacity,
  waveIntensity,
  waveRadius,
  dotColor,
  glowColor,
  performance,
  mousePos,
}: {
  dotSize: number;
  dotSpacing: number;
  dotOpacity: number;
  waveIntensity: number;
  waveRadius: number;
  dotColor: string;
  glowColor: string;
  performance: 'low' | 'medium' | 'high';
  mousePos: { x: number; y: number };
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);
  const mouseRef = useRef(mousePos);

  useEffect(() => {
    mouseRef.current = mousePos;
  }, [mousePos]);

  const drawDots = useCallback(
    (ctx: CanvasRenderingContext2D, time: number) => {
      const { width, height } = ctx.canvas;
      ctx.clearRect(0, 0, width, height);

      const performanceSettings = {
        low: { skip: 3 },
        medium: { skip: 2 },
        high: { skip: 1 },
      };
      const skip = performanceSettings[performance].skip;
      const cols = Math.ceil(width / dotSpacing);
      const rows = Math.ceil(height / dotSpacing);
      const centerX = mouseRef.current.x * width;
      const centerY = mouseRef.current.y * height;

      for (let i = 0; i < cols; i += skip) {
        for (let j = 0; j < rows; j += skip) {
          const x = i * dotSpacing;
          const y = j * dotSpacing;
          const distanceX = x - centerX;
          const distanceY = y - centerY;
          const distance = Math.sqrt(
            distanceX * distanceX + distanceY * distanceY,
          );

          let dotX = x;
          let dotY = y;

          if (distance < waveRadius) {
            const waveStrength = Math.pow(1 - distance / waveRadius, 2);
            const angle = Math.atan2(distanceY, distanceX);
            const waveOffset =
              Math.sin(distance * 0.05 - time * 0.005) *
              waveIntensity *
              waveStrength;
            dotX += Math.cos(angle) * waveOffset;
            dotY += Math.sin(angle) * waveOffset;

            const glowRadius = dotSize * (1 + waveStrength);
            const gradient = ctx.createRadialGradient(
              dotX,
              dotY,
              0,
              dotX,
              dotY,
              glowRadius,
            );
            gradient.addColorStop(
              0,
              glowColor.replace(
                '1)',
                `${dotOpacity * (1 + waveStrength)})`,
              ),
            );
            gradient.addColorStop(1, glowColor.replace('1)', '0)'));
            ctx.fillStyle = gradient;
          } else {
            ctx.fillStyle = dotColor.replace('1)', `${dotOpacity})`);
          }

          ctx.beginPath();
          ctx.arc(dotX, dotY, dotSize / 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    },
    [
      dotColor,
      dotOpacity,
      dotSize,
      dotSpacing,
      glowColor,
      performance,
      waveIntensity,
      waveRadius,
    ],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const context = canvas.getContext('2d');
    if (!context) {
      return;
    }

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    let lastTime = 0;
    const animate = (time: number) => {
      if (time - lastTime > 16) {
        drawDots(context, time);
        lastTime = time;
      }
      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [drawDots]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="absolute inset-0 h-full w-full"
      style={{ mixBlendMode: 'screen' }}
    />
  );
}

function MouseGlow({
  glowColor,
  mousePos,
}: {
  glowColor: string;
  mousePos: { x: number; y: number };
}) {
  return (
    <>
      <div
        className="pointer-events-none absolute h-40 w-40 rounded-full blur-[10px]"
        style={{
          background: `radial-gradient(circle, ${glowColor.replace(
            '1)',
            '0.2)',
          )} 0%, ${glowColor.replace('1)', '0)')} 70%)`,
          left: `${mousePos.x * 100}%`,
          top: `${mousePos.y * 100}%`,
          transform: 'translate(-50%, -50%)',
        }}
      />
      <div
        className="pointer-events-none absolute h-20 w-20 rounded-full"
        style={{
          background: `radial-gradient(circle at center, ${glowColor.replace(
            '1)',
            '0.4)',
          )} 0%, ${glowColor.replace('1)', '0)')} 70%)`,
          left: `${mousePos.x * 100}%`,
          top: `${mousePos.y * 100}%`,
          transform: 'translate(-50%, -50%)',
        }}
      />
    </>
  );
}

const defaultGradients: GradientType[] = [
  {
    stops: [
      { color: '#FFD6A5', position: 0 },
      { color: '#FFADAD', position: 25 },
      { color: '#FFC6FF', position: 50 },
      { color: 'transparent', position: 75 },
    ],
    centerX: 50,
    centerY: 50,
  },
  {
    stops: [
      { color: '#A0C4FF', position: 0 },
      { color: '#BDB2FF', position: 25 },
      { color: '#CAFFBF', position: 50 },
      { color: 'transparent', position: 75 },
    ],
    centerX: 60,
    centerY: 40,
  },
  {
    stops: [
      { color: '#9BF6FF', position: 0 },
      { color: '#FDFFB6', position: 25 },
      { color: '#FFAFCC', position: 50 },
      { color: 'transparent', position: 75 },
    ],
    centerX: 40,
    centerY: 60,
  },
];

export function CanvasFractalGrid({
  dotSize = 3,
  dotSpacing = 20,
  dotOpacity = 0.32,
  gradientAnimationDuration = 8,
  waveIntensity = 50,
  waveRadius = 220,
  gradients = defaultGradients,
  dotColor = 'rgba(129, 140, 248, 1)',
  glowColor = 'rgba(251, 191, 36, 1)',
  enableNoise = true,
  noiseOpacity = 0.025,
  enableMouseGlow = true,
  initialPerformance = 'medium',
  enableGradient = true,
  gradientOpacity = 0.26,
}: CanvasFractalGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { isMobile, isTablet } = useResponsive();
  const performance = usePerformance(initialPerformance);
  const [mousePos, setMousePos] = useState({ x: 0.5, y: 0.5 });
  const frameRef = useRef<number | null>(null);

  const handleMouseMove = useCallback((event: MouseEvent) => {
    if (frameRef.current !== null) {
      return;
    }

    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const { left, top, width, height } =
        containerRef.current?.getBoundingClientRect() ?? {
          left: 0,
          top: 0,
          width: window.innerWidth,
          height: window.innerHeight,
        };
      setMousePos({
        x: (event.clientX - left) / width,
        y: (event.clientY - top) / height,
      });
    });
  }, []);

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, [handleMouseMove]);

  const responsiveDotSize = useMemo(() => {
    if (isMobile) {
      return dotSize * 0.75;
    }
    if (isTablet) {
      return dotSize * 0.9;
    }
    return dotSize;
  }, [dotSize, isMobile, isTablet]);

  const responsiveDotSpacing = useMemo(() => {
    if (isMobile) {
      return dotSpacing * 1.5;
    }
    if (isTablet) {
      return dotSpacing * 1.25;
    }
    return dotSpacing;
  }, [dotSpacing, isMobile, isTablet]);

  return (
    <motion.div
      ref={containerRef}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 1.2, ease: 'easeOut' }}
      className="absolute inset-0 h-full w-full overflow-hidden"
    >
      {enableGradient ? (
        <Gradient
          gradients={gradients}
          animationDuration={gradientAnimationDuration}
          opacity={gradientOpacity}
        />
      ) : null}
      <DotCanvas
        dotSize={responsiveDotSize}
        dotSpacing={responsiveDotSpacing}
        dotOpacity={dotOpacity}
        waveIntensity={waveIntensity}
        waveRadius={waveRadius}
        dotColor={dotColor}
        glowColor={glowColor}
        performance={performance}
        mousePos={mousePos}
      />
      {enableNoise ? <NoiseOverlay opacity={noiseOpacity} /> : null}
      {enableMouseGlow ? (
        <MouseGlow glowColor={glowColor} mousePos={mousePos} />
      ) : null}
    </motion.div>
  );
}

export default React.memo(CanvasFractalGrid);
