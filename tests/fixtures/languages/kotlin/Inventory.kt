package fixtures.inventory

/** Largest count an item may have. */
const val MAX_ITEMS = 100

private val registry = mutableMapOf<String, Item>()

/** Status of an item. */
enum class Status { ACTIVE, RETIRED }

/** Anything that can be restocked. */
interface Stocker {
    /** Adds stock and returns the new count. */
    fun restock(amount: Int): Int
}

/** One stock item. */
class Item(val name: String) : Stocker {
    var count: Int = 0
        private set

    /** Adds stock, capped at MAX_ITEMS. */
    override fun restock(amount: Int): Int {
        count = clamp(count + amount)
        record("restock")
        return count
    }

    private fun record(event: String) {
        registry[name] = this
    }

    companion object {
        /** Creates an item with a normalized name. */
        fun create(name: String): Item = Item(normalize(name))
    }
}

/** Trims and lower-cases a name. */
internal fun normalize(name: String): String = name.trim().lowercase()

/** Keeps a count inside the allowed range. */
private fun clamp(value: Int): Int = when {
    value < 0 -> 0
    else -> minOf(value, MAX_ITEMS)
}

typealias Registry = Map<String, Item>
