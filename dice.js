// dice.js — procedural geometry for dice from d2 up to d1,000,000.
//
// Strategy:
//   • Standard RPG dice get their real shapes (coin, prism, platonic solids).
//   • Arbitrary N (up to VORONOI_MAX) becomes a genuine N-faced solid built from
//     a spherical Voronoi diagram: distribute N seed points evenly on a sphere,
//     take their convex hull (= Delaunay triangulation on the sphere), then the
//     dual of that hull gives exactly N polygonal faces — one per seed.
//   • Very large N is rendered as a high-detail faceted/smooth sphere, because a
//     fair die with that many faces genuinely converges on a sphere.

import * as THREE from 'three';

const VORONOI_MAX = 2500; // exact N-faced solids up to here; beyond -> sphere

// ---------- tiny vector helpers (plain [x,y,z] arrays) ----------
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dist2 = (a, b) => {
  const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
};
const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

// ---------- evenly distribute N points on the unit sphere ----------
function fibonacciSphere(n) {
  const pts = [];
  const golden = Math.PI * (3 - Math.sqrt(5)); // golden angle
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;        // y from 1 .. -1
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    pts.push([Math.cos(theta) * r, y, Math.sin(theta) * r]);
  }
  return pts;
}

// ---------- incremental 3D convex hull ----------
// Returns an array of faces, each { v:[i,j,k], n:[outward unit normal] }.
// For points on a sphere this doubles as the Delaunay triangulation.
function convexHull(pts) {
  const n = pts.length;
  const EPS = 1e-7;

  // pick a non-degenerate starting tetrahedron
  const i0 = 0;
  let i1 = 1, best = -1;
  for (let i = 1; i < n; i++) { const d = dist2(pts[i0], pts[i]); if (d > best) { best = d; i1 = i; } }
  let i2 = -1; best = -1;
  for (let i = 1; i < n; i++) {
    if (i === i1) continue;
    const a = cross(sub(pts[i1], pts[i0]), sub(pts[i], pts[i0]));
    const m = dot(a, a);
    if (m > best) { best = m; i2 = i; }
  }
  const planeN = cross(sub(pts[i1], pts[i0]), sub(pts[i2], pts[i0]));
  let i3 = -1; best = -1;
  for (let i = 1; i < n; i++) {
    if (i === i1 || i === i2) continue;
    const v = Math.abs(dot(planeN, sub(pts[i], pts[i0])));
    if (v > best) { best = v; i3 = i; }
  }

  // interior reference: centroid of the tetra vertices is always inside it,
  // and stays inside as the hull only ever grows outward from there.
  const c = [0, 0, 0];
  for (const k of [i0, i1, i2, i3]) { c[0] += pts[k][0]; c[1] += pts[k][1]; c[2] += pts[k][2]; }
  c[0] /= 4; c[1] /= 4; c[2] /= 4;

  const makeFace = (a, b, cc) => {
    let nrm = cross(sub(pts[b], pts[a]), sub(pts[cc], pts[a]));
    if (dot(nrm, sub(pts[a], c)) < 0) {        // flip so normal points outward
      const t = b; b = cc; cc = t;
      nrm = cross(sub(pts[b], pts[a]), sub(pts[cc], pts[a]));
    }
    return { v: [a, b, cc], n: norm(nrm) };
  };

  let faces = [
    makeFace(i0, i1, i2),
    makeFace(i0, i1, i3),
    makeFace(i0, i2, i3),
    makeFace(i1, i2, i3),
  ];

  const inTetra = new Set([i0, i1, i2, i3]);
  for (let p = 0; p < n; p++) {
    if (inTetra.has(p)) continue;
    const P = pts[p];

    // faces this point can "see"
    const visible = [];
    for (const f of faces) {
      if (dot(f.n, sub(P, pts[f.v[0]])) > EPS) visible.push(f);
    }
    if (visible.length === 0) continue; // point is inside the hull

    // horizon = edges that belong to exactly one visible face
    const count = new Map();
    const order = [];
    for (const f of visible) {
      const [a, b, cc] = f.v;
      for (const [x, y] of [[a, b], [b, cc], [cc, a]]) {
        const key = x < y ? x + ',' + y : y + ',' + x;
        if (count.has(key)) count.set(key, count.get(key) + 1);
        else { count.set(key, 1); order.push([key, x, y]); }
      }
    }

    const visSet = new Set(visible);
    faces = faces.filter((f) => !visSet.has(f));
    for (const [key, x, y] of order) {
      if (count.get(key) === 1) faces.push(makeFace(x, y, p));
    }
  }

  return faces;
}

// ---------- build the dual (Voronoi) solid: exactly N faces ----------
function voronoiGeometry(N) {
  const pts = fibonacciSphere(N);
  const faces = convexHull(pts);

  // Voronoi vertex of each Delaunay triangle = its outward unit normal.
  const vor = faces.map((f) => f.n);

  // gather the triangles incident to each seed point
  const incident = Array.from({ length: N }, () => []);
  faces.forEach((f, fi) => {
    incident[f.v[0]].push(fi);
    incident[f.v[1]].push(fi);
    incident[f.v[2]].push(fi);
  });

  const positions = [];
  for (let i = 0; i < N; i++) {
    const ring = incident[i];
    if (ring.length < 3) continue;

    const P = norm(pts[i]);
    // tangent basis at P to sort the surrounding Voronoi vertices by angle
    const ref = Math.abs(P[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const t1 = norm(cross(P, ref));
    const t2 = cross(P, t1);

    const sorted = ring
      .map((fi) => {
        const c = vor[fi];
        const d = sub(c, P);
        return { fi, ang: Math.atan2(dot(d, t2), dot(d, t1)) };
      })
      .sort((a, b) => a.ang - b.ang);

    // fan-triangulate the polygon formed by the ordered Voronoi vertices
    const v0 = vor[sorted[0].fi];
    for (let k = 1; k < sorted.length - 1; k++) {
      const v1 = vor[sorted[k].fi];
      const v2 = vor[sorted[k + 1].fi];
      positions.push(v0[0], v0[1], v0[2], v1[0], v1[1], v1[2], v2[0], v2[1], v2[2]);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.computeVertexNormals(); // recomputed flat by material.flatShading anyway
  return geo;
}

// ---------- standard RPG dice ----------
const STANDARD = {
  4: { mode: 'tetrahedron (real d4)', make: () => new THREE.TetrahedronGeometry(1) },
  6: { mode: 'cube (real d6)', make: () => new THREE.BoxGeometry(1.25, 1.25, 1.25) },
  8: { mode: 'octahedron (real d8)', make: () => new THREE.OctahedronGeometry(1) },
  12: { mode: 'dodecahedron (real d12)', make: () => new THREE.DodecahedronGeometry(1) },
  20: { mode: 'icosahedron (real d20)', make: () => new THREE.IcosahedronGeometry(1) },
};

// ---------- public API ----------
// Returns { geometry, flatShading, faces, mode }.
export function getDie(N) {
  N = Math.max(2, Math.min(1000000, Math.round(N)));

  if (N === 2) {
    return {
      geometry: new THREE.CylinderGeometry(1.1, 1.1, 0.34, 64),
      flatShading: true,
      faces: 2,
      mode: 'coin — two faces',
    };
  }
  if (N === 3) {
    const g = new THREE.CylinderGeometry(1.05, 1.05, 1.5, 3);
    return { geometry: g, flatShading: true, faces: 3, mode: 'triangular prism (d3)' };
  }
  if (STANDARD[N]) {
    const s = STANDARD[N];
    return { geometry: s.make(), flatShading: true, faces: N, mode: s.mode };
  }

  if (N <= VORONOI_MAX) {
    return {
      geometry: voronoiGeometry(N),
      flatShading: true,
      faces: N,
      mode: `spherical Voronoi solid — exactly ${N.toLocaleString()} faces`,
    };
  }

  // Very large N: a fair die this finely cut is, in the limit, a sphere.
  const detail = Math.min(7, Math.max(2, Math.round(Math.log(N / 20) / Math.log(4))));
  const tris = 20 * 4 ** detail;
  const smooth = detail >= 6;
  return {
    geometry: new THREE.IcosahedronGeometry(1, detail),
    flatShading: !smooth,
    faces: N,
    mode: smooth
      ? `sphere limit — ${N.toLocaleString()} faces ≈ smooth sphere`
      : `faceted sphere — ${N.toLocaleString()} faces (≈${tris.toLocaleString()} facets shown)`,
  };
}
