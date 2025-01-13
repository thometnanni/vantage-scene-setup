<script>
  import Layers from "./lib/Layers.svelte";
  import Map from "./lib/Map.svelte";
  import Exporter from "./lib/Exporter.svelte";

  let area = null;
  let selectedLayer;
  let latlngs = [];

  const handleLayerChange = (event) => {
    selectedLayer = event.detail.layer;
  };
</script>

<div>
  <Layers bind:selectedLayer on:change={handleLayerChange} />
  <Map
    {selectedLayer}
    on:shapeDrawn={(event) => {
      const drawnLayer = event.detail.layer;
      area = L.GeometryUtil.geodesicArea(drawnLayer._latlngs[0]);
      latlngs = drawnLayer._latlngs[0];
    }}
  />
  <Exporter {area} {latlngs} {selectedLayer} />
</div>
