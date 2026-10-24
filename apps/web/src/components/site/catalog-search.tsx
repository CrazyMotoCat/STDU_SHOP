import { SearchInput } from '../ui/primitives';

export function CatalogSearch({ label }: { label: string }) {
  return (
    <form
      action="/catalog"
      aria-label={label}
      className="catalog-search"
      method="get"
      role="search"
    >
      <SearchInput
        enterKeyHint="search"
        label={label}
        maxLength={128}
        name="q"
        placeholder="Поиск в каталоге"
      />
      <button
        aria-label="Найти в каталоге"
        className="catalog-search__submit"
        type="submit"
      >
        <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
          <path d="M5 12h14m-6-6 6 6-6 6" />
        </svg>
      </button>
    </form>
  );
}
