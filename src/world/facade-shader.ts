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

export function facadeShader(shader: ShaderSource): void {
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      `#include <common>
attribute vec4 aWall;
varying vec3 vGWorld;
varying vec3 vGN;
varying vec4 vWall;`,
    )
    .replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
  vGWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
  vGN = objectNormal;
  vWall = aWall;`,
    );
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      `#include <common>
varying vec3 vGWorld;
varying vec3 vGN;
varying vec4 vWall;
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
// returns style parameters per wall material:
//   x floor height (m), y bay width (m), z window width fraction, w window height fraction
vec4 fStyle( float m ) {
  if ( m < 20.5 ) return vec4( 3.0, 3.0, 0.42, 0.42 );            // house
  if ( m < 21.5 ) return vec4( 2.8, 3.0, 0.40, 0.44 );            // generic apartments
  if ( m < 22.5 ) return vec4( 5.0, 6.0, 0.80, 0.16 );            // industrial: high strip windows
  if ( m < 23.5 ) return vec4( 6.0, 5.0, 0.16, 0.62 );            // church: tall narrow
  if ( m < 24.5 ) return vec4( 3.6, 3.6, 0.46, 0.48 );            // public
  if ( m < 25.5 ) return vec4( 2.8, 2.9, 0.38, 0.40 );            // khrushchevka
  if ( m < 26.5 ) return vec4( 2.8, 3.0, 0.40, 0.42 );            // panel
  if ( m < 27.5 ) return vec4( 3.4, 3.4, 0.44, 0.56 );            // stalin
  if ( m < 28.5 ) return vec4( 3.6, 3.0, 1.00, 0.55 );            // modern: glass bands
  if ( m < 29.5 ) return vec4( 3.0, 3.0, 0.00, 0.00 );            // garage
  if ( m < 34.5 ) return vec4( 3.8, 3.6, 0.38, 0.66 );            // historic: tall windows
  return vec4( 3.0, 3.0, 0.42, 0.42 );                             // pastel house variants
}`,
    )
    .replace(
      '#include <color_fragment>',
      `#include <color_fragment>
  float gDist = length( vViewPosition );
  float gFade = 1.0 - smoothstep( 120.0, 400.0, gDist );
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
    if ( gk > 0.1 ) diffuseColor.rgb *= 1.0 + 0.08 * fine * ( gHash( floor( gw * 5.0 ) ) - 0.5 );
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
    } else if ( vWall.x > 3.5 && vWall.x < 4.5 ) {
      // sidewalk: 0.5 m tiles
      vec2 tf = fract( gw / 0.5 );
      float line = 1.0 - ( fBox( tf.x, 0.04, 0.96, 0.08 ) * fBox( tf.y, 0.04, 0.96, 0.08 ) );
      diffuseColor.rgb *= 1.0 - 0.10 * fine * line;
      diffuseColor.rgb *= 1.0 + 0.03 * fine * ( gHash( floor( gw / 0.5 ) ) - 0.5 );
    } else if ( vWall.x > 9.5 && vWall.x < 10.5 ) {
      // plaza: 1.5 m paving with offset courses
      vec2 pg = gw / 1.5;
      pg.x += 0.5 * mod( floor( pg.y ), 2.0 );
      vec2 pf = fract( pg );
      float line = 1.0 - ( fBox( pf.x, 0.03, 0.97, 0.06 ) * fBox( pf.y, 0.03, 0.97, 0.06 ) );
      diffuseColor.rgb *= 1.0 - 0.09 * fine * line;
      diffuseColor.rgb *= 1.0 + 0.04 * fine * ( gHash( floor( pg ) ) - 0.5 );
    }
  } else if ( vWall.y > 0.0 && abs( vGN.y ) < 0.5 ) {
    // ---- walls
    float styleId = vWall.x;
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
    bool carved = vWall.w > 1.5;
    float gcontact = ( vWall.w - 2.0 * step( 1.5, vWall.w ) ) * ( 1.0 - smoothstep( 0.0, 2.2, hy ) );
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
        float lit = step( 0.95, gHash( bcell.xz * 1.37 + bcell.y * 5.3 + 3.1 ) );
        glass = mix( glass, vec3( 0.95, 0.80, 0.50 ), lit * ( shopGlass ? 0.25 : 0.55 ) );
        // thin white frame around each ordinary pane, mullions on shop fronts
        float fw = max( fwidth( fu ), fwidth( fyb ) ) + 1e-4;
        float inner = fBox( fu, 0.07, 0.93, fw ) * fBox( fyb, 0.07, 0.93, fw );
        vec3 frame = shopGlass ? vec3( 0.20, 0.22, 0.24 ) : vec3( 0.90, 0.89, 0.86 );
        float frameAmt = ( 1.0 - inner ) * bdetail * ( shopGlass ? 0.7 : 0.85 );
        bcol = mix( glass, frame, frameAmt );
        bcol = mix( glass * 0.9, bcol, bdetail );
      }
      diffuseColor.rgb = bcol;
    } else if ( styleId > 19.5 && styleId < 39.5 ) {
      vec2 bid = vec2( plane, floor( u / 24.0 ) );
      float r = gHash( bid + 7.3 );
      float r2 = gHash( bid + 1.7 );
      float r3 = gHash( bid + 4.1 );
      if ( carved ) {
        // geometry carries the windows: keep the tint and a faint per-block variation
        vec3 bcell = floor( vGWorld - vGN * 0.5 );
        float bh = gHash( bcell.xz + bcell.y * 17.0 );
        diffuseColor.rgb = base * ( 0.94 + 0.12 * r3 ) * ( 1.0 + 0.07 * gFade * ( bh - 0.5 ) );
      } else {
      vec4 st = fStyle( styleId );
      bool garage = styleId > 28.5 && styleId < 29.5;
      bool stalin = styleId > 26.5 && styleId < 27.5;
      bool historic = styleId > 29.5 && styleId < 34.5;
      bool modern = styleId > 27.5 && styleId < 28.5;
      bool panel = styleId > 25.5 && styleId < 26.5;
      bool apart = ( styleId > 20.5 && styleId < 21.5 ) || ( styleId > 24.5 && styleId < 26.5 );
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
      float fx = fract( bu );
      float bi = floor( bu );
      float pxw = max( fwidth( u ) / bay, 1e-4 );
      float pyw = max( fwidth( vGWorld.y ) / fh, 1e-4 );
      float detail = gFade * ( 1.0 - smoothstep( 0.35, 0.9, max( pxw, pyw ) ) );

      vec3 tint = base * ( 0.92 + 0.16 * r3 );
      vec3 wall = tint;
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
      if ( panel ) {
        float seam = max( 1.0 - fBox( fx, 0.02, 0.98, pxw * 1.5 ), 1.0 - fBox( fy, 0.02, 0.98, pyw * 1.5 ) );
        wall *= 1.0 - 0.10 * detail * seam;
      }
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
        float lit = step( 0.95, gHash( vec2( bi, fl ) * 1.37 + plane + 3.1 ) ) * ( shop > 0.5 ? 0.0 : 1.0 );
        glass = mix( glass, vec3( 0.95, 0.80, 0.50 ), lit * 0.55 );
        if ( entr > 0.5 ) glass = mix( wall * 0.28, vec3( 0.18, 0.12, 0.09 ), 0.5 );
        if ( modern ) glass = mix( glass, vec3( 0.35, 0.50, 0.62 ), 0.3 );
        col = mix( col, glass, inside * detail );
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
      }
    }
    diffuseColor.rgb *= 1.0 - 0.32 * gcontact;
  }`,
    );
}
