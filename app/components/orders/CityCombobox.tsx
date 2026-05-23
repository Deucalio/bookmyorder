import { useEffect, useMemo, useState, KeyboardEvent, useRef } from "react";
import type { CityOption } from "./types";

type CityComboboxProps = {
  cities: CityOption[];
  selectedCityId: string;
  onCitySelect: (cityId: string) => void;
  placeholder?: string;
  error?: boolean;
};

export function CityCombobox({
  cities,
  selectedCityId,
  onCitySelect,
  placeholder = "Search city...",
  error = false,
}: CityComboboxProps) {
  const selectedCity = useMemo(
    () => cities.find((city) => city.id === selectedCityId),
    [cities, selectedCityId],
  );

  const [searchTerm, setSearchTerm] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSearchTerm(selectedCity?.name || "");
  }, [selectedCity?.name, selectedCityId]);

  const filteredCities = useMemo(() => {
    if (!searchTerm) return cities.slice(0, 100);
    const term = searchTerm.toLowerCase();
    return cities.filter(c => c.name.toLowerCase().includes(term)).slice(0, 100);
  }, [cities, searchTerm]);

  // Handle click outside to close dropdown and reset search term to selected value
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearchTerm(selectedCity?.name || "");
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [selectedCity]);

  const handleSelect = (cityId: string) => {
    onCitySelect(cityId);
    setIsOpen(false);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && filteredCities.length > 0) {
      handleSelect(filteredCities[0].id);
    }
  };

  return (
    <div ref={containerRef} className="bmo-combobox-container relative w-full">
      <input
        type="text"
        className={`bmo-combobox-input w-full ${error ? "border-red-500" : ""}`}
        placeholder={placeholder}
        value={searchTerm}
        onChange={(e) => {
          setSearchTerm(e.target.value);
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
        onKeyDown={handleKeyDown}
      />
      {isOpen && (
        <ul className="bmo-combobox-list absolute left-0 right-0 max-h-48 overflow-y-auto bg-white border border-gray-300 rounded-md z-50 shadow-lg mt-1 list-none p-0">
          {filteredCities.map((city) => (
            <li
              key={city.id}
              className="bmo-combobox-option px-3 py-2 text-sm cursor-pointer hover:bg-gray-100"
              onClick={() => handleSelect(city.id)}
            >
              {city.name}
            </li>
          ))}
          {filteredCities.length === 0 && (
            <li className="bmo-combobox-option-empty px-3 py-2 text-sm text-gray-500">
              No cities found
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
