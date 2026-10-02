// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useState } from "react";

/** Follow live system settings until a visitor explicitly chooses a preference. */
export function useMediaPreference(query: string): [boolean, (value: boolean) => void] {
  const [system, setSystem] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  const [override, setOverride] = useState<boolean | null>(null);
  useEffect(() => {
    const media = window.matchMedia(query);
    setSystem(media.matches);
    const change = () => setSystem(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, [query]);
  return [override ?? system, setOverride];
}
