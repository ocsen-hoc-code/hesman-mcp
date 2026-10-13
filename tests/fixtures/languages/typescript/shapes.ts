import { EventEmitter } from 'node:events';

/** Largest radius a circle may have. */
export const MAX_RADIUS = 100;

const defaultUnit = 'cm', defaultScale = 1;

/** Identifier of a shape. */
export type ShapeId = string | number;

/** Anything that has an area. */
export interface Shape {
  readonly id: ShapeId;
  area(): number;
}

/** Colors a shape can be drawn in. */
export enum Color {
  Red,
  Green,
}

/** Clamps a radius into the allowed range. */
function clampRadius(radius: number): number {
  return Math.min(Math.max(radius, 0), MAX_RADIUS);
}

/** A circle that announces when it is resized. */
export class Circle extends EventEmitter implements Shape {
  private radius: number;

  constructor(
    public readonly id: ShapeId,
    radius: number,
  ) {
    super();
    this.radius = clampRadius(radius);
  }

  /** Area of the circle in square units. */
  area(): number {
    return Math.PI * this.radius ** 2;
  }

  private describe(): string {
    return `${this.id}: ${this.radius * defaultScale}${defaultUnit}`;
  }
}

/** Sums the areas of the given shapes. */
export function totalArea(shapes: Shape[]): number {
  /** Adds the area of one shape to the running sum. */
  function addArea(sum: number, shape: Shape): number {
    return sum + shape.area();
  }
  return shapes.reduce(addArea, 0);
}

/** Builds a circle with a radius inside the allowed range. */
export const makeCircle = (id: ShapeId, radius: number): Circle => new Circle(id, clampRadius(radius));

/** Unit conversions. */
export namespace Units {
  /** Converts centimeters to meters. */
  export function toMeters(centimeters: number): number {
    return centimeters / 100;
  }
}
