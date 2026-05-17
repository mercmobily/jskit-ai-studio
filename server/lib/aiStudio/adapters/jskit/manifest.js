import {
  deepFreeze
} from "../../deepFreeze.js";

async function createJskitAdapter() {
  const adapterModule = await import("./index.js");
  return adapterModule.createJskitTargetAdapter();
}

const JSKIT_ADAPTER_MANIFEST = deepFreeze({
  createAdapter: createJskitAdapter,
  enabled: true,
  id: "jskit",
  label: "JSKIT"
});

export {
  JSKIT_ADAPTER_MANIFEST
};
