import { writable } from "svelte/store";

export const osmGeoJSON = writable(null);
export const clippedGeoJSON = writable(null);
export const referencePoint = writable(null);
