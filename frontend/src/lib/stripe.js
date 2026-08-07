import { loadStripe } from "@stripe/stripe-js";

const PK = process.env.REACT_APP_STRIPE_PUBLISHABLE_KEY;

// null until a real publishable key is configured — callers must treat this
// as optional and fall back to the existing redirect Checkout flow.
export const stripePromise = PK ? loadStripe(PK) : null;
