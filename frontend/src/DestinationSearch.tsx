import { useId, useState, type KeyboardEvent } from "react";
import { ChevronRight, Dumbbell, Landmark, LibraryBig, MapPin, Search, X } from "lucide-react";

export type CampusPlace = { id: string; name: string; point: [number, number] };

const shortcuts = [
  { name: "USF Tampa Library", label: "Library", icon: LibraryBig },
  { name: "Phyllis P Marshall Center", label: "Student Center", icon: Landmark },
  { name: "Campus Recreation Center", label: "Rec Center", icon: Dumbbell },
];

export function placeName(place: CampusPlace): string {
  return place.name === "Phyllis P Marshall Center" ? "Marshall Student Center" : place.name;
}

export function DestinationSearch({ places, onChoose }: {
  places: CampusPlace[];
  onChoose: (place: CampusPlace) => void;
}) {
  const listId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const featured = shortcuts.flatMap((shortcut) => {
    const place = places.find(({ name }) => name === shortcut.name);
    return place ? [{ ...shortcut, place }] : [];
  });
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matching = words.length ? places.filter((place) => {
    const shortName = shortcuts.find(({ name }) => name === place.name)?.label;
    const searchable = [place.name, placeName(place), shortName].join(" ").toLowerCase();
    return words.every((word) => searchable.includes(word));
  }).slice(0, 6) : featured.map(({ place }) => place);

  function handleKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!matching.length) return;
      event.preventDefault();
      setOpen(true);
      const step = event.key === "ArrowDown" ? 1 : -1;
      const index = activeIndex < 0 ? (step === 1 ? 0 : matching.length - 1) : activeIndex + step;
      const next = (index + matching.length) % matching.length;
      setActiveIndex(next);
      window.requestAnimationFrame(() => document.getElementById(`${listId}-${next}`)?.scrollIntoView({ block: "nearest" }));
    } else if (event.key === "Enter" && open && matching[activeIndex >= 0 ? activeIndex : 0]) {
      event.preventDefault();
      onChoose(matching[activeIndex >= 0 ? activeIndex : 0]);
    }
  }

  return (
    <div className="destination-search">
      <div className="search-field">
        <Search aria-hidden="true" size={20} />
        <input
          aria-label="Search campus places"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={open && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
          autoComplete="off"
          enterKeyHint="search"
          placeholder="Search campus places"
          role="combobox"
          type="text"
          value={query}
          onFocus={() => setOpen(true)}
          onBlur={() => { setOpen(false); setActiveIndex(-1); }}
          onChange={(event) => { setQuery(event.target.value); setOpen(true); setActiveIndex(-1); }}
          onKeyDown={handleKey}
        />
        {query && (
          <button type="button" className="plain-icon" aria-label="Clear search" onClick={() => { setQuery(""); setActiveIndex(-1); }}>
            <X aria-hidden="true" size={16} />
          </button>
        )}
      </div>
      {open ? (
        <>
          <ul className="search-results" id={listId} role="listbox" aria-label="Campus places">
            {matching.map((place, index) => (
              <li
                id={`${listId}-${index}`}
                key={place.id}
                role="option"
                aria-selected={index === activeIndex}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => onChoose(place)}
              >
                <MapPin aria-hidden="true" size={17} />
                <span>{placeName(place)}</span>
                <ChevronRight aria-hidden="true" size={15} />
              </li>
            ))}
          </ul>
          {!matching.length && <p className="sheet-note" role="status">No matching places. Try another name or drop a pin.</p>}
        </>
      ) : (
        <div className="quick-places" role="group" aria-label="Campus shortcuts">
          {featured.map(({ label, icon: Icon, place }) => (
            <button type="button" key={place.id} onClick={() => onChoose(place)}>
              <Icon aria-hidden="true" size={19} strokeWidth={1.8} />
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
