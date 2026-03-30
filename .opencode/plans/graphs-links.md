## Internal methods

Examples of Internal methods not being connected -

1. `[[DefineOwnProperty]]` - 

* /abstract-operations.html#sec-createdataproperty - `7.3.5 CreateDataProperty` - uses generic `O.[[DefineOwnProperty]]`
* /ordinary-and-exotic-objects-behaviours.html#sec-array-exotic-objects-defineownproperty-p-desc - `10.4.2.1 [[DefineOwnProperty]]` -Array has custom `[[DefineOwnProperty]]`. 
* /ordinary-and-exotic-objects-behaviours.html#sec-ordinary-object-internal-methods-and-internal-slots-defineownproperty-p-desc - `10.1.6 [[DefineOwnProperty]]` - Ordinary definition

2. `[[GetOwnProperty]]` - Similar, defined for proxies


Written in html as (both consumer + definition) -

<var class="field">[[DefineOwnProperty]]</var>

How it works internally for references -

ecmarkup.js - `showReferencesFor(entry)` - uses `entry.referencingIds` from biblio.


Abstract methods list -

File: /ecmascript-data-types-and-values.html#table-essential-internal-methods

[[GetPrototypeOf]]
[[SetPrototypeOf]]
[[IsExtensible]]
[[PreventExtensions]]
[[GetOwnProperty]]
[[DefineOwnProperty]]
[[HasProperty]]
[[Get]]
[[Set]]
[[Delete]]
[[OwnPropertyKeys]]

File: /ecmascript-data-types-and-values.html#table-additional-essential-internal-methods-of-function-objects
[[Call]]
[[Construct]]

*Connect these to the implementations*

Regex to search all -
```
\[\[GetPrototypeOf\]\]|\[\[SetPrototypeOf\]\]|\[\[IsExtensible\]\]|\[\[PreventExtensions\]\]|\[\[GetOwnProperty\]\]|\[\[DefineOwnProperty\]\]|\[\[HasProperty\]\]|\[\[Delete\]\]|\[\[OwnPropertyKeys\]\]|\[\[Call\]\]|\[\[Construct\]\]

\[\[Get\]\]|\[\[Set\]\]
```

Problems -
1. `[[Get]]`, `[[Set]]` - are also used as Property Attributes (/ecmascript-data-types-and-values.html#sec-property-attributes). Distinguish them.
2. Mark all Property Attributes.

