<script>
  import * as turf from "@turf/turf";
  import { clippedGeoJSON, referencePoint, heightStore } from "./stores";

  let newReference = "";
  let height = 4;

  $: {
    $heightStore = height;
    // console.log("Height:", $heightStore);
  }

  $: if ($clippedGeoJSON) {
    $referencePoint = turf.centroid($clippedGeoJSON).geometry.coordinates;
  }

  function copyReferencePoint() {
    if ($referencePoint) {
      const text = `${$referencePoint[1]}, ${$referencePoint[0]}`;
      navigator.clipboard
        .writeText(text)
        .then(() => {
          alert("Reference point copied to clipboard!");
        })
        .catch((err) => console.error("Failed to copy", err));
    }
  }

  function setNewReferencePoint() {
    const parts = newReference
      .split(",")
      .map((part) => parseFloat(part.trim()));

    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      $referencePoint = [parts[1], parts[0]];
    }
  }
</script>

{#if $clippedGeoJSON}
  <button on:click={copyReferencePoint}>Copy Reference Point</button>

  <label>Set Reference Point:</label>
  <input type="text" bind:value={newReference} placeholder="Enter lat, lon" />
  <button on:click={setNewReferencePoint}>Set</button>

  <hr />
  <label>Default level height:</label>
  <input type="number" bind:value={height} placeholder="height..." />
{/if}
