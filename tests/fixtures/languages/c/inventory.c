#include "inventory.h"

/* Keeps a count inside the allowed range. */
static int clamp(int value)
{
    if (value < 0) {
        return 0;
    }
    return value > MAX_ITEMS ? MAX_ITEMS : value;
}

/* Adds stock to an item, capped at MAX_ITEMS. */
int item_restock(item_t *item, int amount)
{
    item->count = clamp(item->count + amount);
    return item->count;
}

/* Name of an item, or a placeholder. */
const char *item_name(const item_t *item)
{
    return item ? item->name : "unknown";
}
