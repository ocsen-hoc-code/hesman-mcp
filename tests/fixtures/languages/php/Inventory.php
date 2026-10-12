<?php

declare(strict_types=1);

namespace Fixtures\Inventory;

/** Largest count an item may have. */
const MAX_ITEMS = 100;

/** Anything that can be restocked. */
interface Stocker
{
    /** Adds stock and returns the new count. */
    public function restock(int $amount): int;
}

/** Keeps a count inside the allowed range. */
function clamp(int $value): int
{
    return max(0, min($value, MAX_ITEMS));
}

/** One stock item. */
class Item implements Stocker
{
    /** Events recorded for this item. */
    private array $log = [];
    public int $count = 0;

    public function __construct(private string $name)
    {
        $this->name = self::normalize($name);
    }

    /** Adds stock, capped at MAX_ITEMS. */
    public function restock(int $amount): int
    {
        $this->count = clamp($this->count + $amount);
        $this->record('restock');
        return $this->count;
    }

    private function record(string $event): void
    {
        $this->log[] = $event;
    }

    protected static function normalize(string $name): string
    {
        return strtolower(trim($name));
    }
}
