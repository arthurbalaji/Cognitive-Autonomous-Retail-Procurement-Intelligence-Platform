#!/bin/sh
set -eu
B=kafka:9092
K=/opt/kafka/bin/kafka-topics.sh
mk() { $K --bootstrap-server $B --create --if-not-exists --topic "$1" --partitions "$2" --replication-factor 1 --config retention.ms="$3"; }
D7=604800000; D3=259200000; D1=86400000; D14=1209600000
mk sales.events 3 $D7
mk inventory.updates 3 $D7
mk procurement.requests 3 $D7
mk po.lifecycle 3 $D7
mk negotiation.events 1 $D3
mk mpi.updates 3 $D1
for t in sales.events inventory.updates procurement.requests po.lifecycle; do mk "$t.DLT" 1 $D14; done
echo "topics ready"; $K --bootstrap-server $B --list
