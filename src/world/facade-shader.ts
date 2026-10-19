/**
 * Procedural detail for the coarse tier, injected into the chunk MeshLambertMaterial:
 *  - upward faces: world-space value noise, asphalt grain, sidewalk tile grid, plaza paving, plus the
 *    fine-tier ground (ballast, worn road markings, rail steel, footway slabs, grass speckle);
 *  - building walls: windows, bays, plinth, cornice, shop fronts, entrances, lit windows, per style,
 *    keyed by the `aWall` vertex attribute (wall material id, top y, base y, ground-contact flag);
 *    1 m block-tier faces (w >= 2) keep only tint and per-block variation, and glass blocks (ids 45, 50)
 *    get sky reflection, lit panes and frames;
 *  - wall-base contact AO.
 * All detail fades out by ~400 m (and with fwidth) to avoid moire.
 */
interface ShaderSource {
  vertexShader: string;
  fragmentShader: string;
}

/** Shared constant uniform for materials that never fade. */
const NO_FADE = { value: 1 };

/**
 * Shared "lights on" amount (0 by day .. 1 at night), driven by the time of day: lit windows, shop fronts
 * and street-lamp lenses glow in proportion to it. One object for every material, so a time change is a
 * uniform write and never a recompile.
 */
export const NIGHT_UNIFORM = { value: 0 };

/**
 * Material hook. A material may carry `userData.uFade = { value }` (0..1): the fragment shader then
 * screen-door dithers the surface in (ordered interleaved-gradient noise, no blending), used to
 * cross-fade a new detail tier over the one underneath it.
 */
export function facadeShader(this: { userData?: Record<string, unknown> } | void, shader: ShaderSource & { uniforms: Record<string, { value: unknown }> }): void {
  const fade = (this && this.userData?.uFade) as { value: number } | undefined;
  shader.uniforms.uFade = fade ?? NO_FADE;
  shader.uniforms.uNight = NIGHT_UNIFORM;
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      `#include <common>
attribute vec4 aWall;
attribute vec2 aRun;
varying vec3 vGWorld;
varying vec3 vGN;
varying vec4 vWall;
varying vec2 vRun;`,
    )
    .replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
  #ifdef USE_BATCHING
  vGWorld = ( modelMatrix * batchingMatrix * vec4( transformed, 1.0 ) ).xyz;
  #else
  vGWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
  #endif
  vGN = objectNormal;
  vWall = aWall;
  vRun = aRun;`,
    );
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      `#include <common>
varying vec3 vGWorld;
varying vec3 vGN;
varying vec4 vWall;
varying vec2 vRun;
uniform float uFade;
uniform float uNight;
// light added after lighting (see emissivemap_fragment below): lit windows and lamp lenses
vec3 gGlow = vec3( 0.0 );
// warm tungsten, pale warm, neutral white, a few cool TV-blue rooms
vec3 gWinCol( float h ) {
  if ( h < 0.5 ) return vec3( 1.0, 0.58, 0.24 );
  if ( h < 0.8 ) return vec3( 1.0, 0.76, 0.42 );
  if ( h < 0.92 ) return vec3( 0.98, 0.94, 0.82 );
  return vec3( 0.55, 0.72, 1.0 );
}
float gHash( vec2 p ) {
  p = fract( p * vec2( 0.1031, 0.1030 ) );
  p += dot( p, p.yx + 33.33 );
  return fract( ( p.x + p.y ) * p.x );
}
float gVNoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( gHash( i ), gHash( i + vec2( 1.0, 0.0 ) ), f.x ), mix( gHash( i + vec2( 0.0, 1.0 ) ), gHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}
// anti-aliased box: 1 inside [lo, hi] along one axis, softened by the pixel footprint w
float fBox( float v, float lo, float hi, float w ) {
  return clamp( ( v - lo ) / w + 0.5, 0.0, 1.0 ) * clamp( ( hi - v ) / w + 0.5, 0.0, 1.0 );
}
// ---- micro detail (<= 10 cm), world space. p = (u along wall, y); px = pixel footprint in metres
float fFade( float px, float lo, float hi ) { return 1.0 - smoothstep( lo, hi, px ); }
// dark line of width lw (m) at multiples of period
float fLine( float v, float period, float lw, float px ) {
  float f = fract( v / period ) * period;
  float d = min( f, period - f );
  return 1.0 - clamp( ( d - lw * 0.5 ) / max( px, 1e-4 ) + 0.5, 0.0, 1.0 );
}
vec3 fMicro( vec3 c, float id, vec2 p, float hy, float px, float seed, float gf ) {
  float k = gf;
  if ( k <= 0.0 ) return c;
  // Brick is an explicit OSM material style (WALL_BRICK = 39); colour is never used to guess it.
  bool brick = id > 38.5 && id < 39.5;
  if ( brick ) {
    float ch = 0.075;
    float row = floor( p.y / ch );
    float uu = p.x / 0.26 + 0.5 * mod( row, 2.0 );
    float bf = fract( p.y / ch );
    float uf = fract( uu );
    float mx = max( px / 0.26, 1e-4 ), my = max( px / ch, 1e-4 );
    float inB = clamp( ( uf - 0.02 ) / mx + 0.5, 0.0, 1.0 ) * clamp( ( 0.98 - uf ) / mx + 0.5, 0.0, 1.0 )
      * clamp( ( bf - 0.07 ) / my + 0.5, 0.0, 1.0 ) * clamp( ( 0.93 - bf ) / my + 0.5, 0.0, 1.0 );
    float bt = gHash( vec2( floor( uu ), row ) + seed );
    float f = k * fFade( px, 0.04, 0.16 );
    c *= 1.0 + f * 0.10 * ( bt - 0.5 );
    c = mix( c, c * 0.80 + 0.03, f * ( 1.0 - inB ) * 0.8 );
  } else if ( id > 24.5 && id < 25.5 ) {
    // Khrushchevka: pebble-dash ("камешки") panels. Stones of ~1.5 cm, light, dark and rusty, in a grey
    // render; 5 cm clusters keep the texture visible at 10-30 m; faint joints at each storey and 3.2 m.
    vec2 pq = vec2( p.x + seed * 2.0, p.y );
    vec2 sc = floor( pq * 65.0 );
    float s1 = gHash( sc + seed );
    float s2 = gHash( sc * 1.31 + 7.7 );
    float fs = k * fFade( px, 0.008, 0.05 );
    float stone = ( step( 0.80, s1 ) * 0.16 - step( s1, 0.16 ) * 0.17 ) * fs;
    c *= 1.0 + stone;
    c = mix( c, c * vec3( 1.10, 0.92, 0.78 ), step( 0.93, s2 ) * fs * 0.6 );
    float cl = gVNoise( pq * 20.0 ) * 0.6 + gVNoise( pq * 7.0 ) * 0.4;
    c *= 1.0 + 0.11 * k * fFade( px, 0.03, 0.25 ) * ( cl - 0.5 );
    float seam = max( fLine( pq.x, 3.2, 0.03, px ), fLine( pq.y, 3.0, 0.03, px ) );
    float f = k * fFade( px, 0.12, 0.7 );
    c *= 1.0 - 0.10 * f * seam;
    c *= 1.0 + 0.04 * f * ( gHash( floor( vec2( pq.x / 3.2, pq.y / 3.0 ) ) + seed ) - 0.5 );
  } else if ( id > 25.5 && id < 26.5 ) {
    // panel seams: 3.0 x 1.4 m panels, dark joints, faint per-panel tone
    vec2 pq = vec2( p.x + seed * 3.0, p.y - 0.0 );
    float jl = max( fLine( pq.x, 3.0, 0.03, px ), fLine( pq.y, 1.4, 0.03, px ) );
    float f = k * fFade( px, 0.15, 0.7 );
    c *= 1.0 - 0.22 * f * jl;
    c *= 1.0 + 0.05 * f * ( gHash( floor( vec2( pq.x / 3.0, pq.y / 1.4 ) ) + seed ) - 0.5 );
    c *= 1.0 + 0.04 * k * fFade( px, 0.03, 0.12 ) * ( gHash( floor( p * 25.0 ) ) - 0.5 );
  } else if ( ( id > 21.5 && id < 22.5 ) || ( id > 28.5 && id < 29.5 ) ) {
    // corrugated sheet: vertical ribs every 15 cm
    float rib = sin( p.x * 41.8879 );
    c *= 1.0 + 0.11 * k * fFade( px, 0.03, 0.10 ) * rib;
    c *= 1.0 + 0.04 * k * ( gVNoise( vec2( p.x * 0.7, p.y * 0.2 ) ) - 0.5 );
  } else {
    // plaster: grain at 3-30 cm, large soft mottling
    float g = gVNoise( p * 9.0 ) * 0.55 + gVNoise( p * 33.0 ) * 0.45;
    c *= 1.0 + 0.07 * k * fFade( px, 0.03, 0.2 ) * ( g - 0.5 );
    c *= 1.0 + 0.05 * k * ( gVNoise( p * 0.9 + seed ) - 0.5 );
  }
  // weathering: vertical streaks, strongest near the ground, damp band at the foot
  float st = gVNoise( vec2( p.x * 2.3 + seed, p.y * 0.12 ) );
  float st2 = gVNoise( vec2( p.x * 6.1, p.y * 0.3 + seed ) );
  float streak = smoothstep( 0.55, 0.9, st ) * ( 0.5 + 0.5 * st2 );
  c *= 1.0 - 0.10 * k * streak * ( 0.4 + 0.6 * ( 1.0 - smoothstep( 0.0, 5.0, hy ) ) );
  c *= 1.0 - 0.10 * k * ( 1.0 - smoothstep( 0.1, 0.9, hy ) ) * ( 0.6 + 0.8 * gVNoise( p * 3.0 ) );
  return c;
}
// Per-building tint (0..3, baked from the OSM id): four subtle brightness / warmth variants per style
// family, applied to the whole building. Brick and historic walls shift in warmth as well as value;
// panel, public and industrial walls mostly in value; houses and pastel variants in warmth.
vec3 gTintMul( float m, float t ) {
  bool brick = m > 38.5 && m < 39.5;
  bool grey = ( m > 21.5 && m < 24.5 ) || ( m > 25.5 && m < 29.5 );
  if ( brick ) {
    if ( t < 0.5 ) return vec3( 1.0 );
    if ( t < 1.5 ) return vec3( 1.07, 1.05, 0.97 );
    if ( t < 2.5 ) return vec3( 0.90, 0.88, 0.86 );
    return vec3( 1.04, 0.95, 0.89 );
  }
  if ( grey ) {
    if ( t < 0.5 ) return vec3( 1.0 );
    if ( t < 1.5 ) return vec3( 1.07 );
    if ( t < 2.5 ) return vec3( 0.90 );
    return vec3( 0.96, 0.98, 1.04 );
  }
  if ( t < 0.5 ) return vec3( 1.0 );
  if ( t < 1.5 ) return vec3( 1.06, 1.04, 0.97 );
  if ( t < 2.5 ) return vec3( 0.93, 0.95, 0.98 );
  return vec3( 1.03, 0.98, 0.93 );
}
// returns style parameters per wall material:
//   x floor height (m), y bay width (m), z window width fraction, w window height fraction
vec4 fStyle( float m ) {
  if ( m < 20.5 ) return vec4( 3.0, 3.0, 0.42, 0.42 );            // house
  if ( m < 21.5 ) return vec4( 2.8, 3.0, 0.40, 0.44 );            // generic apartments
  if ( m < 22.5 ) return vec4( 5.0, 6.0, 0.80, 0.16 );            // industrial: high strip windows
  if ( m < 23.5 ) return vec4( 6.0, 5.0, 0.16, 0.62 );            // church: tall narrow
  if ( m < 24.5 ) return vec4( 3.6, 3.6, 0.46, 0.48 );            // public
  if ( m < 25.5 ) return vec4( 3.0, 4.0, 0.42, 0.50 );            // khrushchevka: 1.5 m windows, 2 m piers
  if ( m < 26.5 ) return vec4( 2.8, 3.0, 0.40, 0.42 );            // panel
  if ( m < 27.5 ) return vec4( 3.4, 3.4, 0.44, 0.56 );            // stalin
  if ( m < 28.5 ) return vec4( 3.6, 3.0, 1.00, 0.55 );            // modern: glass bands
  if ( m < 29.5 ) return vec4( 3.0, 3.0, 0.00, 0.00 );            // garage
  if ( m < 34.5 ) return vec4( 3.8, 3.6, 0.38, 0.66 );            // historic: tall windows
  if ( m < 39.5 ) return vec4( 2.8, 3.0, 0.40, 0.44 );            // explicit silicate/red brick apartments
  return vec4( 3.0, 3.0, 0.42, 0.42 );                             // pastel house variants
}`,
    )
    .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += gGlow;')
    .replace(
      '#include <color_fragment>',
      `#include <color_fragment>
  if ( uFade < 1.0 && fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) ) >= uFade ) discard;
  float gDist = length( vViewPosition );
  float gFade = 1.0 - smoothstep( 120.0, 400.0, gDist );
  gGlow = vec3( 0.0 );
  if ( vGN.y > 0.5 ) {
    // ---- ground and roofs
    float gn = ( gVNoise( vGWorld.xz / 8.0 ) * 0.6 + gVNoise( vGWorld.xz / 32.0 ) * 0.4 ) * 2.0 - 1.0;
    vec3 gc = diffuseColor.rgb;
    float gk = ( gc.g > gc.r * 1.1 && gc.g > gc.b * 1.1 ) ? 0.12 : 0.06;
    diffuseColor.rgb *= 1.0 + gk * gn;
    // aWall.x carries the ground material of upward faces that have extra detail
    vec2 gw = vGWorld.xz;
    float px = max( fwidth( gw.x ), fwidth( gw.y ) );
    float fine = gFade * ( 1.0 - smoothstep( 0.15, 0.6, px ) );
    // 0.2 m blades-of-grass speckle on green ground (matters for the fine tier only; fades with distance)
    if ( gk > 0.1 ) {
      diffuseColor.rgb *= 1.0 + 0.08 * fine * ( gHash( floor( gw * 5.0 ) ) - 0.5 );
      // tufts (~0.5 m clumps) and dry / lush colour patches
      float tuft = gVNoise( gw * 2.2 );
      diffuseColor.rgb *= 1.0 + 0.10 * fine * ( tuft - 0.5 );
      float dry = smoothstep( 0.6, 0.85, gVNoise( gw / 6.0 + 17.0 ) );
      diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 1.18, 1.02, 0.7 ), 0.35 * dry * gFade );
    }
    // dirt: pebbly texture
    if ( gc.r > gc.g * 1.15 && gc.g > gc.b * 1.2 && vWall.x < 0.5 ) diffuseColor.rgb *= 1.0 + 0.12 * fine * ( gHash( floor( gw * 9.0 ) ) - 0.5 );
    if ( vWall.x > 6.5 && vWall.x < 7.5 ) {
      // rail ballast: coarse gravel
      float gv = gHash( floor( gw * 8.0 ) ) * 0.65 + gHash( floor( gw * 23.0 ) ) * 0.35;
      diffuseColor.rgb *= 1.0 + 0.30 * fine * ( gv - 0.5 );
    } else if ( vWall.x > 10.5 && vWall.x < 11.5 ) {
      // road marking: flat white, chipped and dirtied by wear noise
      float wear = gVNoise( gw * 7.0 ) * 0.6 + gVNoise( gw * 29.0 ) * 0.4;
      float worn = smoothstep( 0.52, 0.78, wear ) * 0.45;
      diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.38, 0.39, 0.40 ), worn * mix( 0.35, 1.0, fine ) );
      diffuseColor.rgb *= 1.0 + 0.06 * fine * ( gHash( floor( gw * 5.0 ) ) - 0.5 );
    } else if ( vWall.x > 11.5 && vWall.x < 12.5 ) {
      // steel rail head: faint brushed variation
      diffuseColor.rgb *= 1.0 + 0.16 * fine * ( gHash( floor( gw * 12.0 ) ) - 0.5 );
    } else if ( vWall.x > 13.5 && vWall.x < 14.5 ) {
      // footway paving: 0.4 m slabs
      vec2 pv = gw / 0.4;
      vec2 pf2 = fract( pv );
      float pline = 1.0 - ( fBox( pf2.x, 0.03, 0.97, 0.06 ) * fBox( pf2.y, 0.03, 0.97, 0.06 ) );
      diffuseColor.rgb *= 1.0 - 0.12 * fine * pline;
      diffuseColor.rgb *= 1.0 + 0.06 * fine * ( gHash( floor( pv ) ) - 0.5 );
    } else if ( vWall.x > 2.5 && vWall.x < 3.5 ) {
      // asphalt: fine grain
      float gr = gHash( floor( gw * 6.0 ) );
      diffuseColor.rgb *= 1.0 + 0.10 * fine * ( gr - 0.5 );
      // sparse low-frequency darker patches (repairs, oil) and hairline cracks along noise iso-lines
      float pat = gVNoise( gw / 3.5 + 11.0 );
      diffuseColor.rgb *= 1.0 - 0.14 * gFade * smoothstep( 0.62, 0.8, pat );
      float cn = gVNoise( gw * 0.55 + 5.0 );
      float cw = max( fwidth( cn ), 1e-4 );
      float crack = 1.0 - smoothstep( 0.0, 1.0, abs( cn - 0.5 ) / ( cw * 1.5 ) );
      float cmask = smoothstep( 0.68, 0.85, gVNoise( gw / 9.0 + 2.0 ) );
      // cracks are pixel-wide iso-lines, so they must stay faint and close or they read as drawn curves
      float cnear = 1.0 - smoothstep( 4.0, 12.0, gDist );
      diffuseColor.rgb *= 1.0 - 0.16 * crack * cmask * cnear * fine * ( 1.0 - smoothstep( 0.05, 0.25, px ) );
    } else if ( vWall.x > 3.5 && vWall.x < 4.5 ) {
      // sidewalk: 0.5 m tiles
      vec2 tf = fract( gw / 0.5 );
      float line = 1.0 - ( fBox( tf.x, 0.04, 0.96, 0.08 ) * fBox( tf.y, 0.04, 0.96, 0.08 ) );
      diffuseColor.rgb *= 1.0 - 0.10 * fine * line;
      float th = gHash( floor( gw / 0.5 ) + 3.0 );
      diffuseColor.rgb *= 1.0 + 0.03 * fine * ( gHash( floor( gw / 0.5 ) ) - 0.5 );
      // the odd darker / cracked tile
      diffuseColor.rgb *= 1.0 - 0.08 * fine * step( 0.93, th ) - 0.05 * fine * step( 0.985, th );
      vec2 tc = tf - 0.5;
      float tcr = 1.0 - smoothstep( 0.0, 0.03 + px, abs( tc.x * 0.8 + tc.y * 0.6 + 0.1 * sin( tc.y * 9.0 ) ) );
      diffuseColor.rgb *= 1.0 - 0.25 * fine * tcr * step( 0.97, th );
    } else if ( vWall.x > 9.5 && vWall.x < 10.5 ) {
      // plaza: 1.5 m paving with offset courses
      vec2 pg = gw / 1.5;
      pg.x += 0.5 * mod( floor( pg.y ), 2.0 );
      vec2 pf = fract( pg );
      float line = 1.0 - ( fBox( pf.x, 0.03, 0.97, 0.06 ) * fBox( pf.y, 0.03, 0.97, 0.06 ) );
      diffuseColor.rgb *= 1.0 - 0.09 * fine * line;
      diffuseColor.rgb *= 1.0 + 0.04 * fine * ( gHash( floor( pg ) ) - 0.5 );
    }
  } else if ( vWall.x > 50.5 && vWall.x < 51.5 ) {
    // ---- street-lamp lens (prop face looking down)
    diffuseColor.rgb = vec3( 0.96, 0.92, 0.80 );
    gGlow = vec3( 1.0, 0.78, 0.42 ) * 3.0 * uNight;
  } else if ( vWall.y > 0.0 && abs( vGN.y ) < 0.5 ) {
    // ---- walls
    // coarse building walls carry style + 0.1 * tint in aWall.x
    float styleId = floor( vWall.x + 0.02 );
    float tintId = floor( fract( vWall.x + 0.02 ) * 10.0 );
    float wallTop = vWall.y;
    float wallBase = vWall.z;
    bool ax = abs( vGN.x ) > 0.5;
    float u = ax ? vGWorld.z : vGWorld.x;
    // walls lie on the 2 m voxel grid: snap so per-pixel interpolation error can't flicker the hashes
    float plane = floor( ( ax ? vGWorld.x : vGWorld.z ) * 0.5 + 0.5 );
    float hy = vGWorld.y - wallBase;
    float totalH = max( wallTop - wallBase, 0.5 );
    // contact AO at the wall base, fading over ~2 m
    // aWall.w: ground-contact flag, +2 on 1 m block faces whose windows, doors and trims are real geometry
    // +4 marks a 1 m slot (reveal) between solid blocks
    float recessF = step( 5.5, vWall.w );
    float wcode = vWall.w - 4.0 * recessF;
    bool carved = wcode > 1.5;
    float gcontact = ( wcode - 2.0 * step( 1.5, wcode ) ) * ( 1.0 - smoothstep( 0.0, 2.2, hy ) );
    float mpx = max( fwidth( u ), fwidth( vGWorld.y ) );
    float mk = gFade;
    vec3 base = diffuseColor.rgb;
    if ( styleId > 44.5 && styleId < 59.5 ) {
      // ---- block-tier details: glass (45), shop glass (50), trims, concrete, metal, doors
      vec3 bcell = floor( vGWorld - vGN * 0.5 );
      float bh = gHash( bcell.xz + bcell.y * 17.0 );
      float fu = fract( ax ? vGWorld.z : vGWorld.x );
      float fyb = fract( vGWorld.y );
      float bpx = max( fwidth( u ), fwidth( vGWorld.y ) );
      float bdetail = gFade * ( 1.0 - smoothstep( 0.3, 0.9, bpx ) );
      vec3 bcol = base * ( 1.0 + 0.10 * gFade * ( bh - 0.5 ) );
      if ( styleId > 44.5 && styleId < 45.5 || styleId > 49.5 && styleId < 50.5 ) {
        bool shopGlass = styleId > 49.5;
        // sky-gradient reflection, a little different per pane
        float gv = shopGlass ? 0.45 : 1.0;
        vec3 glassLow = vec3( 0.12, 0.16, 0.21 );
        vec3 glassHigh = vec3( 0.46, 0.58, 0.70 ) * gv;
        vec3 glass = mix( glassLow, glassHigh, fyb * fyb * ( 3.0 - 2.0 * fyb ) * ( 0.7 + 0.3 * bh ) );
        // about one pane in twenty is lit
        // by day about one pane in twenty is lit; at night most shop fronts and a patchy 40% of windows
        // (neighbourhoods differ), the same panes staying lit, with a few colour temperatures
        float occ = 0.55 + 0.9 * gVNoise( bcell.xz * 0.09 + 4.0 );
        float litP = shopGlass ? mix( 0.05, 0.78, uNight ) : mix( 0.05, 0.55 * occ, uNight );
        float lit = step( 1.0 - litP, gHash( bcell.xz * 1.37 + bcell.y * 5.3 + 3.1 ) );
        glass = mix( glass, vec3( 0.95, 0.80, 0.50 ), lit * ( shopGlass ? 0.25 : 0.55 ) * ( 1.0 - 0.8 * uNight ) );
        float glowAmt = lit * uNight * ( 0.65 + 0.55 * gHash( bcell.xz * 2.9 + bcell.y * 1.7 ) );
        // thin white frame around each ordinary pane, mullions on shop fronts
        float fw = max( fwidth( fu ), fwidth( fyb ) ) + 1e-4;
        float inner = fBox( fu, 0.07, 0.93, fw ) * fBox( fyb, 0.07, 0.93, fw );
        // most frames are white PVC; some old painted wood: blue or brown (owner's photos)
        float fh = gHash( floor( bcell.xz / 2.0 ) * 0.73 + bcell.y * 2.1 + 5.0 );
        vec3 frame = shopGlass ? vec3( 0.20, 0.22, 0.24 )
          : fh < 0.12 ? vec3( 0.30, 0.48, 0.70 ) : fh < 0.22 ? vec3( 0.48, 0.36, 0.25 ) : vec3( 0.90, 0.89, 0.86 );
        float frameAmt = ( 1.0 - inner ) * bdetail * ( shopGlass ? 0.7 : 0.85 );
        bcol = mix( glass, frame, frameAmt );
        bcol = mix( glass * 0.9, bcol, bdetail );
        // set back behind the reveal: darker at the back, gradient toward the pane edges
        float edgeD = min( min( fu, 1.0 - fu ), min( fyb, 1.0 - fyb ) );
        bcol *= 0.86 * ( 1.0 - 0.30 * bdetail * ( 1.0 - smoothstep( 0.0, 0.5, edgeD ) ) );
        gGlow = gWinCol( gHash( bcell.xz * 2.17 + bcell.y * 3.3 + 9.0 ) ) * glowAmt * ( shopGlass ? 0.9 : 0.62 ) * mix( 1.0, 0.25 + 0.75 * inner, bdetail );
      }
      if ( styleId > 46.5 && styleId < 47.5 ) {
        // bare concrete: grain, faint board marks
        bcol *= 1.0 + 0.10 * bdetail * ( gVNoise( vec2( u, vGWorld.y ) * 14.0 ) - 0.5 ) + 0.05 * gFade * ( gVNoise( vec2( u, vGWorld.y ) * 1.7 ) - 0.5 );
      }
      diffuseColor.rgb = bcol;
    } else if ( styleId > 19.5 && styleId < 39.5 ) {
      // wall run (coarse walls): the hash seed is the run's start; blocks have no run (vRun.y = 0)
      float runL = vRun.y;
      bool hasRun = runL > 0.5;
      vec2 bid = vec2( plane, hasRun ? floor( ( u - vRun.x ) * 0.5 + 0.5 ) : floor( u / 24.0 ) );
      float r = gHash( bid + 7.3 );
      float r2 = gHash( bid + 1.7 );
      if ( carved ) {
        // geometry carries the windows: keep the tint and a faint per-block variation
        vec3 bcell = floor( vGWorld - vGN * 0.5 );
        float bh = gHash( bcell.xz + bcell.y * 17.0 );
        vec3 cc = base * gTintMul( styleId, tintId ) * ( 1.0 + 0.07 * gFade * ( bh - 0.5 ) );
        cc = fMicro( cc, styleId, vec2( u, vGWorld.y ), hy, mpx, r, mk * fFade( mpx, 0.3, 1.0 ) );
        // reveal / slot: occluded, darker toward the middle of the 1 m channel
        cc *= 1.0 - recessF * ( 0.26 + 0.10 * gFade );
        diffuseColor.rgb = cc;
      } else {
      vec4 st = fStyle( styleId );
      bool garage = styleId > 28.5 && styleId < 29.5;
      bool stalin = styleId > 26.5 && styleId < 27.5;
      bool historic = styleId > 29.5 && styleId < 34.5;
      bool modern = styleId > 27.5 && styleId < 28.5;
      bool panel = styleId > 25.5 && styleId < 26.5;
      bool brick = styleId > 38.5 && styleId < 39.5;
      bool apart = ( styleId > 20.5 && styleId < 21.5 ) || ( styleId > 24.5 && styleId < 26.5 ) || brick;
      bool pub = styleId > 23.5 && styleId < 24.5;
      // floors stretch slightly so that whole floors fit between plinth and top
      float nFloors = max( 1.0, floor( totalH / st.x + 0.5 ) );
      float fh = totalH / nFloors;
      float fy = hy / fh;
      float fl = floor( fy );
      fy = fract( fy );
      // distance-adaptive bay width keeps the pattern stable
      float bay = st.y * ( 0.9 + 0.2 * r );
      float bu = u / bay;
      if ( hasRun ) {
        // a whole number of bays fits the run, so windows are never cut at its ends
        bay = runL / max( 1.0, floor( runL / bay + 0.5 ) );
        bu = vRun.x / bay;
      }
      float fx = fract( bu );
      float bi = floor( bu );
      float pxw = max( fwidth( u ) / bay, 1e-4 );
      float pyw = max( fwidth( vGWorld.y ) / fh, 1e-4 );
      float detail = gFade * ( 1.0 - smoothstep( 0.35, 0.9, max( pxw, pyw ) ) );

      vec3 tint = base * gTintMul( styleId, tintId );
      vec3 wall = fMicro( tint, styleId, vec2( u, vGWorld.y ), hy, max( fwidth( u ), fwidth( vGWorld.y ) ), r, gFade * fFade( max( pxw * bay, pyw * fh ), 0.3, 1.0 ) );
      // ground-floor shop fronts on public / modern / historic / stalin
      float shopChance = ( pub || modern || historic || stalin ) ? 0.55 : 0.0;
      float shop = ( fl < 0.5 && gHash( vec2( bi, plane ) + bid ) < shopChance ) ? 1.0 : 0.0;
      // entrances on apartment blocks: one bay in ~6 on the ground floor
      float entr = ( apart || stalin ) && fl < 0.5 && mod( bi + floor( r * 6.0 ), 6.0 ) < 0.5 ? 1.0 : 0.0;
      shop *= 1.0 - entr;

      vec4 wr = vec4( 0.5 - st.z * 0.5, 0.5 + st.z * 0.5, 0.5 - st.w * 0.5, 0.5 + st.w * 0.5 );
      wr.zw += vec2( 0.04 );
      if ( modern ) { wr.x = 0.0; wr.y = 1.0; }
      if ( shop > 0.5 ) wr = vec4( 0.08, 0.92, 0.12, 0.80 );
      if ( entr > 0.5 ) wr = vec4( 0.28, 0.72, 0.0, 0.70 );
      // windows are kept clear of the top band
      float lastFloor = fl > nFloors - 1.5 ? 1.0 : 0.0;
      if ( lastFloor > 0.5 && wr.w > 0.78 ) wr.w = 0.78;
      bool hasWin = !garage;
      if ( styleId > 21.5 && styleId < 22.5 ) hasWin = fl > 0.5 || totalH < 7.0; // industrial: strip only above ground
      // panel blocks: seam grid
      if ( stalin ) {
        // rustication / vertical pilaster tone on every 3rd bay edge
        wall *= 1.0 - 0.06 * detail * ( 1.0 - fBox( fx, 0.06, 0.94, pxw * 1.5 ) );
      }
      vec3 col = wall;
      // top and bottom bands first, then windows inside the floor cell
      float plinth = 1.0 - smoothstep( 0.8, 0.8 + 0.12, hy );
      float corniceH = ( historic || stalin ) ? 0.9 : 0.5;
      float cornice = smoothstep( totalH - corniceH - 0.1, totalH - corniceH, hy );
      float winM = 0.0;
      if ( hasWin && !garage ) {
        float inside = fBox( fx, wr.x, wr.y, pxw * 1.5 ) * fBox( fy, wr.z, wr.w, pyw * 1.5 );
        // arched look: round the top of historic windows
        if ( historic ) {
          float cxn = ( fx - 0.5 ) / max( 0.5 * st.z, 0.01 );
          float arch = wr.w - 0.12 * cxn * cxn;
          inside *= 1.0 - smoothstep( arch - pyw, arch + pyw, fy ) * step( 0.7, fy );
        }
        // recess: dark reveal around the glass, skipped for shop fronts and glass bands
        float rev = fBox( fx, wr.x - 0.03, wr.y + 0.03, pxw * 1.5 ) * fBox( fy, wr.z - 0.03, wr.w + 0.03, pyw * 1.5 );
        if ( shop < 0.5 && !modern ) col = mix( col, wall * 0.62, rev * detail );
        // glass reflects a sky gradient
        float gy = clamp( ( fy - wr.z ) / max( wr.w - wr.z, 0.01 ), 0.0, 1.0 );
        vec3 glassLow = vec3( 0.13, 0.17, 0.22 );
        vec3 glassHigh = vec3( 0.46, 0.58, 0.70 );
        vec3 glass = mix( glassLow, glassHigh, gy * gy * ( 3.0 - 2.0 * gy ) );
        // by day one window in twenty; at night about 40% of them (more in some buildings), shop fronts mostly
        float occ = 0.4 + 1.2 * r2;
        float litP = mix( 0.05, 0.36 * occ, uNight );
        float lit = step( 1.0 - litP, gHash( vec2( bi, fl ) * 1.37 + plane + 3.1 ) ) * ( shop > 0.5 ? 0.0 : 1.0 );
        float shopLit = shop > 0.5 ? step( 0.25, gHash( vec2( bi, plane ) * 2.3 + bid ) ) : 0.0;
        float entrLit = entr > 0.5 ? step( 0.3, gHash( vec2( bi, plane ) * 1.9 + bid ) ) : 0.0;
        float glowAmt = max( lit, max( shopLit, entrLit ) ) * uNight * ( 0.65 + 0.55 * gHash( vec2( bi, fl ) * 3.7 + plane ) );
        glass = mix( glass, vec3( 0.95, 0.80, 0.50 ), lit * 0.55 * ( 1.0 - 0.8 * uNight ) );
        if ( entr > 0.5 ) glass = mix( wall * 0.28, vec3( 0.18, 0.12, 0.09 ), 0.5 );
        if ( modern ) glass = mix( glass, vec3( 0.35, 0.50, 0.62 ), 0.3 );
        col = mix( col, glass, inside * detail );
        gGlow = gWinCol( gHash( vec2( bi, fl ) * 2.17 + plane + 9.0 ) ) * glowAmt * ( shop > 0.5 ? 0.9 : 0.62 ) * inside * detail;
        // white frames: cross bars on ordinary windows
        if ( shop < 0.5 && entr < 0.5 && !modern ) {
          float fr = max( 1.0 - fBox( fx, 0.0, 1.0, 1.0 ), 0.0 );
          float barV = step( abs( fx - 0.5 ), pxw * 1.5 + 0.015 );
          float barH = step( abs( fy - 0.5 * ( wr.z + wr.w ) ), pyw * 1.5 + 0.012 );
          float rimX = 1.0 - fBox( fx, wr.x + 0.025, wr.y - 0.025, pxw );
          float rimY = 1.0 - fBox( fy, wr.z + 0.02, wr.w - 0.02, pyw );
          float frame = clamp( max( rimX, rimY ) + max( barV, barH ), 0.0, 1.0 );
          col = mix( col, vec3( 0.92, 0.91, 0.88 ), frame * inside * detail * 0.9 );
        }
        if ( modern ) {
          float mullion = step( abs( fx - 0.5 ), pxw * 1.5 + 0.01 );
          col = mix( col, wall * 0.7, mullion * inside * detail );
        }
        // door canopy line above entrances
        if ( entr > 0.5 ) col = mix( col, wall * 0.55, ( 1.0 - fBox( fy, 0.0, 0.76, pyw * 1.5 ) ) * fBox( fx, 0.22, 0.78, pxw * 1.5 ) * detail );
      }
      if ( garage ) {
        // wide gate per 3 m at ground level, no upper windows
        float gate = fBox( fx, 0.12, 0.88, pxw * 1.5 ) * fBox( hy / 2.4, 0.0, 1.0, pyw * 1.5 ) * step( hy, 2.6 );
        col = mix( col, wall * 0.5 + vec3( 0.03, 0.04, 0.05 ), gate * detail );
        float rib = step( abs( fract( hy * 4.0 ) - 0.5 ), 0.12 );
        col *= 1.0 - 0.10 * rib * gate * detail;
      }
      col = mix( col, wall * 0.78, plinth * detail * ( shop > 0.5 ? 0.0 : 1.0 ) );
      col = mix( col, wall * 0.78, plinth * ( 1.0 - detail ) * 0.4 );
      // cornice: light band with a dark shadow line beneath
      vec3 corniceCol = mix( wall, vec3( 0.92, 0.90, 0.84 ), ( historic || stalin ) ? 0.55 : 0.35 );
      col = mix( col, corniceCol, cornice * ( detail * 0.9 + 0.1 ) );
      col *= 1.0 - 0.18 * detail * ( ( historic || stalin ) ? 1.0 : 0.5 ) * ( smoothstep( totalH - corniceH - 0.45, totalH - corniceH - 0.1, hy ) - smoothstep( totalH - corniceH - 0.1, totalH - corniceH, hy ) );
      // far away fall back to the averaged tint (windows darken the wall a little)
      vec3 avg = wall * mix( 0.9, 0.84, clamp( st.z * st.w * 4.0, 0.0, 1.0 ) );
      diffuseColor.rgb = mix( avg, col, detail );
      // too far for windows: scattered warm light, so the lit city still reads at distance
      float farLit = smoothstep( 0.55, 0.75, gVNoise( vec2( u, vGWorld.y ) * 0.35 + bid ) );
      gGlow += vec3( 1.0, 0.62, 0.28 ) * 0.2 * uNight * ( 1.0 - detail ) * farLit * clamp( st.z * st.w * 4.0, 0.0, 1.0 ) * step( hy, totalH - 0.8 );
      }
    }
    diffuseColor.rgb *= 1.0 - 0.32 * gcontact;
  }`,
    );
}
