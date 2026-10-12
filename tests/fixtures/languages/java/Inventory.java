package fixtures.inventory;

import java.util.ArrayList;
import java.util.List;

/** Anything that can be restocked. */
interface Stocker {
    /** Adds stock and returns the new count. */
    int restock(int amount);
}

/** One stock item. */
public class Inventory implements Stocker {
    /** Largest count an item may have. */
    public static final int MAX_ITEMS = 100;
    private final List<String> log = new ArrayList<>();
    private int count;

    /** Creates an inventory with a starting count. */
    public Inventory(int count) {
        this.count = clamp(count);
    }

    /** Adds stock, capped at MAX_ITEMS. */
    @Override
    public int restock(int amount) {
        count = clamp(count + amount);
        record("restock");
        return count;
    }

    private void record(String event) {
        log.add(event);
    }

    /** Keeps a count inside the allowed range. */
    static int clamp(int value) {
        if (value < 0) {
            return 0;
        }
        return Math.min(value, MAX_ITEMS);
    }

    /** Status of an item. */
    public enum Status { ACTIVE, RETIRED }
}
