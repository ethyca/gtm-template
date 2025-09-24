const callInWindow = require("callInWindow");
const injectScript = require("injectScript");
const setDefaultConsentState = require("setDefaultConsentState");
const updateConsentState = require("updateConsentState");
const createQueue = require("createQueue");

const dataLayerPush = createQueue("dataLayer");

/*
 * Because we can't rely on Fides.js to be initialized or even loaded before the GTM container, we use
 * the GTM events to update the consent state. If Fides.js runs before this, it will push the events to
 * the dataLayer and they will be processed asynchronously when the GTM container loads. To get the Fides*
 * events, the page loading Fides.js needs to call Fides.gtm() immediately after.
 *
 * The events we are interested in:
 *
 *   gtm.init_consent  - The default consent initialization event that GTM fires when the container loads
 *   FidesInitialized  - The event that Fides.js fires when it has initialized
 *   FidesUpdating     - This is the event that Fides.js fires when the consent state is being updated
 *
 * The expected behavior for a consent mode template is to set the default consent state when the GTM
 * container loads and then update it with the actual user preference. The consent is not saved across
 * page loads, which is why we call updateConsentState on FidesInitialized.
 */

// The `data` object referenced throughout this template is a reference to the GTM template's configuration fields, which are defined in template-params.json
// GTM docs reference: https://developers.google.com/tag-platform/tag-manager/templates#create_your_first_custom_tag_template

// Time to wait for Fides.js to initialize and update the consent
const WAIT_FOR_UPDATE = data.waitForUpdate;

// Map between GTM and Fides consent types
// associates Fides privacy notice keys with consent mode categories
const CONSENT_MAP = {
  ad_storage: [
    "marketing",
    "data_sales_and_sharing",
    "data_sales_sharing_gpp_us_state",
    "data_sharing_gpp_us_state",
    "data_sales_gpp_us_state",
    "targeted_advertising_gpp_us_state",
  ],
  ad_user_data: [
    "marketing",
    "data_sales_and_sharing",
    "data_sales_sharing_gpp_us_state",
    "data_sharing_gpp_us_state",
    "data_sales_gpp_us_state",
    "targeted_advertising_gpp_us_state",
  ],
  ad_personalization: [
    "marketing",
    "data_sales_and_sharing",
    "data_sales_sharing_gpp_us_state",
    "data_sharing_gpp_us_state",
    "data_sales_gpp_us_state",
    "targeted_advertising_gpp_us_state",
  ],
  analytics_storage: ["analytics"],
  functionality_storage: ["functional"],
  personalization_storage: ["functional"],
  security_storage: ["essential"],
};

const isFidesEvent = data.event.indexOf("Fides") > -1;
const isFidesConsentModeEvent = data.event.indexOf("FidesConsentMode") > -1;
const isNonConsentModeFidesEvent = isFidesEvent && !isFidesConsentModeEvent;

if (data.event === "gtm.init_consent") {
  // The default Consent Initialization trigger fired
  // sets Consent Mode "On-Page Default" states only

  // Reads regional consent overrides defined in the configuration and sets the default consent state
  // This step ensures that the regional consent overrides take precedence
  // By default regional overrides are not included in the template
  if (data.regionalOverrides) {
    for (const defaults of data.regionalOverrides) {
      const obj = {};
      for (const key in defaults) {
        obj[key] = defaults[key];
      }
      obj.region = defaults.region.split(",").map((r) => r.trim());
      obj.wait_for_update = WAIT_FOR_UPDATE;
      setDefaultConsentState(obj);
    }
  }

  // Sets default consent values according to the tag configuration
  // Will be overridden by regional consent values set above
  const consent = {};
  for (const key in CONSENT_MAP) {
    consent[key] = data["default_" + key];
  }
  consent.wait_for_update = WAIT_FOR_UPDATE;
  setDefaultConsentState(consent);

  if (data.scriptUrl) {
    return injectScript(
      data.scriptUrl,
      function () {
        callInWindow("Fides.gtm");
        data.gtmOnSuccess();
      },
      data.gtmOnFailure
    );
  }
} else if (isNonConsentModeFidesEvent) {
  // This update only has an effect when Fides.consent contains privacy notice keys
  updateGTMConsent(data.fides.consent, data.event);
}

return data.gtmOnSuccess();

// Only function definitions below this line

// *** UPDATE THE GTM CONSENT STATE ACCORDING TO THE STATE OF THE CONFIGURED FIDES CONSENT PRIVACY NOTICES ***
// 1. Compare the Fides.consent object against the CONSENT_MAP
// 2. If the consent value is found in the CONSENT_MAP, set the corresponding GTM consent signal
// 3. When the Fides consent value is not found, it won't be used in the consent update event, meaning we fall back to regional defaults
function updateGTMConsent(fidesConsent, event) {
  const gtmConsent = {};
  const fidesConsentModeEvent = "FidesConsentMode" + event.split("Fides")[1];

  for (const key in CONSENT_MAP) {
    const values = [];
    for (const value of CONSENT_MAP[key]) {
      const consent = fidesConsent[value];
      if (consent !== undefined) {
        values.push(consent);
      }
    }
    gtmConsent[key] = values.every((value) => value) ? "granted" : "denied";
  }

  updateConsentState(gtmConsent);

  // Push an event to the dataLayer that represents the updated consent mode state
  // This event will contain the latest consent update state and can be used as a trigger event
  dataLayerPush({
    Fides: data.fides.consent,
    event: fidesConsentModeEvent,
  });
}
