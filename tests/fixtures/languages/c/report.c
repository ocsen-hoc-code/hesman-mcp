#include "inventory.h"

/* Restocks an item twice and returns the new count. */
int report_double(item_t *item, int amount)
{
    item_restock(item, amount);
    return item_restock(item, amount);
}
