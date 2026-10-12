#ifndef INVENTORY_H
#define INVENTORY_H

/* Largest count an item may have. */
#define MAX_ITEMS 100

/* One stock item. */
struct item {
    const char *name;
    int count;
};

/* Status of an item. */
enum status { STATUS_ACTIVE, STATUS_RETIRED };

typedef struct item item_t;

/* Adds stock to an item, capped at MAX_ITEMS. */
int item_restock(item_t *item, int amount);

#endif
