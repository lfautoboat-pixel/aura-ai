// Icon per option, keyed by position (not translated text) so the mapping
// stays correct across every locale — only questions rendered in the
// "grid-icon" layout (see quiz.js LAYOUTS) need an entry here.
import {
  Sparkles, Sun, Compass, Gem, Globe, Heart,
  Ban, MessageSquareOff, Wind, HeartCrack, ShieldAlert,
  DoorOpen, Flame, Eye, KeyRound, Shield,
} from "lucide-react";

export const OPTION_ICONS = {
  q3: [Sparkles, Sun, Compass, Gem],
  q4: [Globe, Globe, Globe, Globe, Heart],
  q9: [Ban, MessageSquareOff, Wind, Compass, HeartCrack, ShieldAlert, Sparkles],
  q10: [DoorOpen, Wind, Flame, Eye, KeyRound, Shield],
};

export function getOptionIcon(questionId, index) {
  return OPTION_ICONS[questionId]?.[index] || Sparkles;
}
