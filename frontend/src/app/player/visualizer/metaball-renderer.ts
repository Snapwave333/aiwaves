// Ported from CarbonCast IPTV (libs/portal/radio/feature/src/lib/radio-visualizer/
// radio-metaball-renderer.ts and radio-trail-buffer.ts; MIT, see THIRD_PARTY_NOTICES.md).
// AIWaves changes: the canvas size comes from the component (one ResizeObserver for sizing and
// repainting), and the frame carries the palette (accent hue, rim colour) instead of a free hue.
import { EnergyFrame } from './audio-energy';
import { linkFadeProgram, linkMetaballProgram } from './metaball-program';
import { ORB_COUNT, computeOrbPlacements, orbHue } from './orb-choreography';

/** Above 2x the extra pixels are invisible but the fill cost is not. */
const MAX_PIXEL_RATIO = 2;
/**
 * The shader evaluates a seven-orb field five times per pixel and the canvas is blurred by 7 px on
 * the way to the screen, so resolution past this budget is spent on detail the blur destroys.
 */
const MAX_DRAWING_BUFFER_PIXELS = 1_600_000;
/** Time for a trail to fade to 1/e: mostly visible behind the orb that darts on the beat. */
const TRAIL_FADE_SECONDS = 0.14;
/** A longer gap means the loop parked and resumed: drop the trail instead of smearing across it. */
const MAX_TRAIL_STEP_SECONDS = 0.2;

export interface MetaballFrame {
  /** Seconds of animation so far. Monotonic. */
  time: number;
  /** Hue offset (revolutions) added to every orb: a slow sway driven by the music. */
  sway: number;
  /** The lead orb's hue in revolutions: the cover art's accent. */
  accentHue: number;
  /** Rim light colour, linear 0..1 RGB (the accent). */
  rim: readonly [number, number, number];
  energy: EnergyFrame;
  /** Song identity, so each song opens on its own arrangement of parts. */
  seed: number;
  /** Off for reduced motion. */
  trails: boolean;
}

export interface DrawingBufferSize {
  width: number;
  height: number;
}

/** Device-pixel size for a canvas of the given CSS size, within the fill budget. */
export function computeDrawingBufferSize(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
): DrawingBufferSize {
  const ratio = Math.min(Math.max(devicePixelRatio || 1, 0.5), MAX_PIXEL_RATIO);
  const width = Math.max(1, cssWidth * ratio);
  const height = Math.max(1, cssHeight * ratio);
  const budgetScale = Math.min(1, Math.sqrt(MAX_DRAWING_BUFFER_PIXELS / (width * height)));
  // floored: rounding both axes up can push the result back over the budget
  return {
    width: Math.max(1, Math.floor(width * budgetScale)),
    height: Math.max(1, Math.floor(height * budgetScale)),
  };
}

/**
 * The offscreen buffer the motion trails live in. They cannot accumulate in the drawing buffer:
 * the compositor may clear it between frames.
 */
class TrailBuffer {
  private texture: WebGLTexture | null = null;
  private framebuffer: WebGLFramebuffer | null = null;
  private width = 0;
  private height = 0;
  private primed = false;

  private constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly fadeProgram: WebGLProgram,
  ) {}

  static create(gl: WebGL2RenderingContext): TrailBuffer | null {
    const fade = linkFadeProgram(gl);
    return fade ? new TrailBuffer(gl, fade) : null;
  }

  /** False when no buffer can be had; the caller then draws straight to the canvas. */
  resize(width: number, height: number): boolean {
    if (this.framebuffer && this.width === width && this.height === height) return true;
    const gl = this.gl;
    this.release();
    const texture = gl.createTexture();
    const framebuffer = gl.createFramebuffer();
    if (!texture || !framebuffer) return false;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!complete) {
      gl.deleteTexture(texture);
      gl.deleteFramebuffer(framebuffer);
      return false;
    }
    this.texture = texture;
    this.framebuffer = framebuffer;
    this.width = width;
    this.height = height;
    this.primed = false;
    return true;
  }

  /** Binds the buffer and ages its contents by `elapsed` seconds (time-based, not per frame). */
  beginFrame(elapsed: number): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    if (!this.primed || elapsed > MAX_TRAIL_STEP_SECONDS || elapsed < 0) {
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      this.primed = true;
      return;
    }
    // multiplied in place (ZERO, CONSTANT_COLOR): no second texture to ping-pong against
    const keep = Math.exp(-elapsed / TRAIL_FADE_SECONDS);
    gl.useProgram(this.fadeProgram);
    gl.blendColor(keep, keep, keep, keep);
    gl.blendFunc(gl.ZERO, gl.CONSTANT_COLOR);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  /** Copies the accumulated trail to the canvas. */
  present(): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.framebuffer);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.blitFramebuffer(
      0,
      0,
      this.width,
      this.height,
      0,
      0,
      this.width,
      this.height,
      gl.COLOR_BUFFER_BIT,
      gl.NEAREST,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  dispose(): void {
    this.release();
    this.gl.deleteProgram(this.fadeProgram);
  }

  private release(): void {
    if (this.texture) this.gl.deleteTexture(this.texture);
    if (this.framebuffer) this.gl.deleteFramebuffer(this.framebuffer);
    this.texture = null;
    this.framebuffer = null;
    this.width = 0;
    this.height = 0;
    this.primed = false;
  }
}

/** Draws the liquid-metaball backdrop: the per-pixel field sum runs in a fragment shader. */
export class MetaballRenderer {
  private readonly uniforms: Record<
    'resolution' | 'hue' | 'level' | 'rim' | 'orbs' | 'orbHues',
    WebGLUniformLocation | null
  >;
  private readonly orbData = new Float32Array(ORB_COUNT * 4);
  private readonly orbHueData = new Float32Array(ORB_COUNT * 2);
  private readonly trail: TrailBuffer | null;
  private cssWidth = 0;
  private cssHeight = 0;
  private lastFrameTime: number | null = null;

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly gl: WebGL2RenderingContext,
    private readonly program: WebGLProgram,
  ) {
    this.uniforms = {
      resolution: gl.getUniformLocation(program, 'uResolution'),
      hue: gl.getUniformLocation(program, 'uHue'),
      level: gl.getUniformLocation(program, 'uLevel'),
      rim: gl.getUniformLocation(program, 'uRim'),
      orbs: gl.getUniformLocation(program, 'uOrbs'),
      orbHues: gl.getUniformLocation(program, 'uOrbHues'),
    };
    this.trail = TrailBuffer.create(gl);
    gl.useProgram(program);
    gl.enable(gl.BLEND);
    // premultiplied alpha: the shader already scales colour by alpha, so no dark fringe
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  /** Null when WebGL2 or the shader is unavailable; the caller then hides the canvas. */
  static create(canvas: HTMLCanvasElement): MetaballRenderer | null {
    if (typeof WebGL2RenderingContext === 'undefined') return null;
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      premultipliedAlpha: true,
      powerPreference: 'low-power',
    });
    if (!gl) return null;
    const program = linkMetaballProgram(gl);
    return program ? new MetaballRenderer(canvas, gl, program) : null;
  }

  /** The canvas's CSS size (kept by the caller's ResizeObserver, so no layout read per frame). */
  setSize(cssWidth: number, cssHeight: number): void {
    this.cssWidth = cssWidth;
    this.cssHeight = cssHeight;
  }

  render(frame: MetaballFrame): void {
    const gl = this.gl;
    const { width, height } = computeDrawingBufferSize(
      this.cssWidth,
      this.cssHeight,
      globalThis.devicePixelRatio,
    );
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      gl.viewport(0, 0, width, height);
    }
    const trailing = frame.trails && this.trail !== null && this.trail.resize(width, height);

    const placements = computeOrbPlacements(
      frame.time,
      frame.energy,
      width / Math.max(1, height),
      frame.seed,
    );
    for (let i = 0; i < ORB_COUNT; i++) {
      const orb = placements[i];
      this.orbData[i * 4] = orb.x;
      this.orbData[i * 4 + 1] = orb.y;
      this.orbData[i * 4 + 2] = orb.radius;
      this.orbData[i * 4 + 3] = orb.layer;
      const angle = orbHue(i, frame.accentHue) * Math.PI * 2;
      this.orbHueData[i * 2] = Math.cos(angle);
      this.orbHueData[i * 2 + 1] = Math.sin(angle);
    }

    const elapsed = this.lastFrameTime === null ? Infinity : frame.time - this.lastFrameTime;
    this.lastFrameTime = frame.time;
    if (trailing) this.trail!.beginFrame(elapsed);
    else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }

    gl.useProgram(this.program);
    gl.uniform2f(this.uniforms.resolution, width, height);
    gl.uniform1f(this.uniforms.hue, frame.sway);
    gl.uniform1f(this.uniforms.level, frame.energy.level);
    gl.uniform3f(this.uniforms.rim, frame.rim[0], frame.rim[1], frame.rim[2]);
    gl.uniform4fv(this.uniforms.orbs, this.orbData);
    gl.uniform2fv(this.uniforms.orbHues, this.orbHueData);

    if (trailing) {
      // combined with MAX, not composited over: compositing integrates a stationary region into a
      // wash far brighter than its own frame; MAX leaves it at its value and lets vacated pixels decay
      gl.blendEquation(gl.MAX);
      gl.blendFunc(gl.ONE, gl.ONE);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (trailing) {
      gl.blendEquation(gl.FUNC_ADD);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      this.trail!.present();
    }
  }

  dispose(): void {
    this.trail?.dispose();
    this.gl.deleteProgram(this.program);
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
