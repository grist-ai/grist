export const G = 9.81;
export const MASS = 1.2;
export const ARM = 0.18;
export const MAX_MOTOR_THRUST = 4.5;

const IXX = 0.008;
const IYY = 0.015;
const IZZ = 0.008;
const KYAW = 0.05;

const KP_V = 1.6;
const KP_ATT = 6;
const KP_RATE = 10;
const KP_YAW_RATE = 8;
const MAX_SPEED = 6;
const MAX_VSPEED = 3;
const MAX_RATE = 3.5;
const MAX_YAW_RATE = 2.5;
const ACCEL_LIMIT = 6.5;
const MAX_TOTAL = 4 * MAX_MOTOR_THRUST;
const LINEAR_DRAG = 0.05;
const ANGULAR_DRAG = 0.02;
const GROUND_RESTITUTION = 0.2;
const GROUND_FRICTION = 5;
const REST_Y = 0.06;

const MOTOR_POS = [
  { x: ARM, z: ARM },
  { x: ARM, z: -ARM },
  { x: -ARM, z: -ARM },
  { x: -ARM, z: ARM },
];
const MOTOR_SPIN = [-1, 1, -1, 1];

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

class V {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }
  set(x, y, z) {
    this.x = x; this.y = y; this.z = z;
    return this;
  }
  clone() {
    return new V(this.x, this.y, this.z);
  }
  copy(v) {
    this.x = v.x; this.y = v.y; this.z = v.z;
    return this;
  }
  add(v) {
    this.x += v.x; this.y += v.y; this.z += v.z;
    return this;
  }
  sub(v) {
    this.x -= v.x; this.y -= v.y; this.z -= v.z;
    return this;
  }
  addScaled(v, s) {
    this.x += v.x * s; this.y += v.y * s; this.z += v.z * s;
    return this;
  }
  scale(s) {
    this.x *= s; this.y *= s; this.z *= s;
    return this;
  }
  length() {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
  }
  normalize() {
    const l = this.length();
    if (l > 1e-9) this.scale(1 / l);
    return this;
  }
  dot(v) {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }
  cross(v) {
    return this.set(
      this.y * v.z - this.z * v.y,
      this.z * v.x - this.x * v.z,
      this.x * v.y - this.y * v.x,
    );
  }
  applyQuat(q) {
    const ix = q.w * this.x + q.y * this.z - q.z * this.y;
    const iy = q.w * this.y + q.z * this.x - q.x * this.z;
    const iz = q.w * this.z + q.x * this.y - q.y * this.x;
    const iw = -q.x * this.x - q.y * this.y - q.z * this.z;
    return this.set(
      ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
      iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
      iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x,
    );
  }
}

class Q {
  constructor(x = 0, y = 0, z = 0, w = 1) {
    this.x = x; this.y = y; this.z = z; this.w = w;
  }
  clone() {
    return new Q(this.x, this.y, this.z, this.w);
  }
  copy(q) {
    this.x = q.x; this.y = q.y; this.z = q.z; this.w = q.w;
    return this;
  }
  identity() {
    return this.set(0, 0, 0, 1);
  }
  set(x, y, z, w) {
    this.x = x; this.y = y; this.z = z; this.w = w;
    return this;
  }
  normalize() {
    const l = Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w);
    if (l > 1e-9) {
      this.x /= l; this.y /= l; this.z /= l; this.w /= l;
    }
    return this;
  }
  conjugate() {
    return this.set(-this.x, -this.y, -this.z, this.w);
  }
  multiply(q) {
    const { x, y, z, w } = this;
    return this.set(
      w * q.x + x * q.w + y * q.z - z * q.y,
      w * q.y - x * q.z + y * q.w + z * q.x,
      w * q.z + x * q.y - y * q.x + z * q.w,
      w * q.w - x * q.x - y * q.y - z * q.z,
    );
  }
}

function quatFromBasis(right, up, fwd) {
  const m00 = right.x, m01 = up.x, m02 = fwd.x;
  const m10 = right.y, m11 = up.y, m12 = fwd.y;
  const m20 = right.z, m21 = up.z, m22 = fwd.z;
  const trace = m00 + m11 + m22;
  const q = new Q();
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    q.w = 0.25 * s;
    q.x = (m21 - m12) / s;
    q.y = (m02 - m20) / s;
    q.z = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q.w = (m21 - m12) / s;
    q.x = 0.25 * s;
    q.y = (m01 + m10) / s;
    q.z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q.w = (m02 - m20) / s;
    q.x = (m01 + m10) / s;
    q.y = 0.25 * s;
    q.z = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q.w = (m10 - m01) / s;
    q.x = (m02 + m20) / s;
    q.y = (m12 + m21) / s;
    q.z = 0.25 * s;
  }
  return q.normalize();
}

export class Sim {
  constructor() {
    this.pos = new V();
    this.vel = new V();
    this.q = new Q();
    this.omega = new V();
    this.motors = [0, 0, 0, 0];
    this.yawTarget = 0;
    this.reset();
  }
  reset() {
    this.pos.set(0, 2, 0);
    this.vel.set(0, 0, 0);
    this.q.identity();
    this.omega.set(0, 0, 0);
    this.motors = [0, 0, 0, 0];
    this.yawTarget = 0;
  }
  bodyUp() {
    return new V(0, 1, 0).applyQuat(this.q);
  }
  forward() {
    return new V(0, 0, 1).applyQuat(this.q);
  }
  step(dt, input = {}) {
    const fwdIn = clamp(input.forward || 0, -1, 1);
    const strIn = clamp(input.strafe || 0, -1, 1);
    const verIn = clamp(input.vertical || 0, -1, 1);
    const yawIn = clamp(input.yaw || 0, -1, 1);

    this.yawTarget += yawIn * MAX_YAW_RATE * dt;

    const fwdWorld = this.forward();
    const fwdH = new V(fwdWorld.x, 0, fwdWorld.z);
    if (fwdH.length() < 1e-4) fwdH.set(Math.sin(this.yawTarget), 0, Math.cos(this.yawTarget));
    fwdH.normalize();
    const rightH = new V(fwdH.z, 0, -fwdH.x);

    const vTarget = new V(
      fwdH.x * fwdIn * MAX_SPEED + rightH.x * strIn * MAX_SPEED,
      verIn * MAX_VSPEED,
      fwdH.z * fwdIn * MAX_SPEED + rightH.z * strIn * MAX_SPEED,
    );

    const aDes = new V(
      (vTarget.x - this.vel.x) * KP_V,
      (vTarget.y - this.vel.y) * KP_V,
      (vTarget.z - this.vel.z) * KP_V,
    );
    const aH = Math.hypot(aDes.x, aDes.z);
    if (aH > ACCEL_LIMIT) {
      const s = ACCEL_LIMIT / aH;
      aDes.x *= s;
      aDes.z *= s;
    }

    const fDes = new V(aDes.x * MASS, (aDes.y + G) * MASS, aDes.z * MASS);
    let tCmd = fDes.length();
    const upDes = tCmd > 1e-6 ? fDes.clone().scale(1 / tCmd) : new V(0, 1, 0);
    tCmd = clamp(tCmd, 0, MAX_TOTAL);

    const heading = new V(Math.sin(this.yawTarget), 0, Math.cos(this.yawTarget));
    let fwdDes = heading.clone().addScaled(upDes, -heading.dot(upDes));
    if (fwdDes.length() < 1e-4) fwdDes = new V(0, 0, 1).addScaled(upDes, -upDes.z);
    fwdDes.normalize();
    const rightDes = upDes.clone().cross(fwdDes);
    const qTarget = quatFromBasis(rightDes, upDes, fwdDes);

    const qErr = this.q.clone().conjugate().multiply(qTarget.clone());
    if (qErr.w < 0) qErr.set(-qErr.x, -qErr.y, -qErr.z, -qErr.w);
    const angle = 2 * Math.acos(clamp(qErr.w, -1, 1));
    const sinHalf = Math.sin(angle / 2);
    const axis = sinHalf > 1e-6
      ? new V(qErr.x / sinHalf, qErr.y / sinHalf, qErr.z / sinHalf)
      : new V(0, 0, 0);
    const rateDes = axis.scale(angle * KP_ATT);
    const rl = rateDes.length();
    if (rl > MAX_RATE) rateDes.scale(MAX_RATE / rl);

    const torque = new V(
      IXX * KP_RATE * (rateDes.x - this.omega.x),
      IYY * KP_YAW_RATE * (rateDes.y - this.omega.y),
      IZZ * KP_RATE * (rateDes.z - this.omega.z),
    );

    const aMix = -torque.x / ARM;
    const bMix = torque.z / ARM;
    const cMix = -torque.y / KYAW;
    this.motors = [
      clamp((tCmd + aMix + bMix - cMix) / 4, 0, MAX_MOTOR_THRUST),
      clamp((tCmd - aMix + bMix + cMix) / 4, 0, MAX_MOTOR_THRUST),
      clamp((tCmd - aMix - bMix - cMix) / 4, 0, MAX_MOTOR_THRUST),
      clamp((tCmd + aMix - bMix + cMix) / 4, 0, MAX_MOTOR_THRUST),
    ];
    const m = this.motors;
    const totalThrust = m[0] + m[1] + m[2] + m[3];
    const bodyTorque = new V(
      -ARM * (m[0] - m[1] - m[2] + m[3]),
      -KYAW * (-m[0] + m[1] - m[2] + m[3]),
      ARM * (m[0] + m[1] - m[2] - m[3]),
    );

    const force = new V(0, -G * MASS, 0);
    force.addScaled(this.bodyUp(), totalThrust);
    const speed = this.vel.length();
    if (speed > 1e-4) force.addScaled(this.vel, -LINEAR_DRAG * speed);

    this.vel.addScaled(force, dt / MASS);
    this.pos.addScaled(this.vel, dt);

    bodyTorque.addScaled(this.omega, -ANGULAR_DRAG);
    const iOmega = new V(IXX * this.omega.x, IYY * this.omega.y, IZZ * this.omega.z);
    bodyTorque.sub(this.omega.clone().cross(iOmega));
    this.omega.x += (bodyTorque.x / IXX) * dt;
    this.omega.y += (bodyTorque.y / IYY) * dt;
    this.omega.z += (bodyTorque.z / IZZ) * dt;

    const dq = this.q.clone().multiply(
      new Q(this.omega.x * 0.5, this.omega.y * 0.5, this.omega.z * 0.5, 0),
    );
    this.q.x += dq.x * dt;
    this.q.y += dq.y * dt;
    this.q.z += dq.z * dt;
    this.q.w += dq.w * dt;
    this.q.normalize();

    if (this.pos.y < REST_Y) {
      this.pos.y = REST_Y;
      if (this.vel.y < 0) this.vel.y = -this.vel.y * GROUND_RESTITUTION;
      this.vel.x -= this.vel.x * Math.min(1, GROUND_FRICTION * dt);
      this.vel.z -= this.vel.z * Math.min(1, GROUND_FRICTION * dt);
      this.omega.scale(1 - Math.min(1, 10 * dt));
      if (Math.abs(this.vel.y) < 0.05) this.vel.y = 0;
    }
  }
}

export const MotorPositions = MOTOR_POS;
export const MotorSpin = MOTOR_SPIN;
export function tiltDegrees(sim) {
  const up = sim.bodyUp();
  return (Math.acos(clamp(up.y, -1, 1)) * 180) / Math.PI;
}