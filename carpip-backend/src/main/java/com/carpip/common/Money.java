package com.carpip.common;

import java.math.BigDecimal;
import java.math.RoundingMode;

/** Money rules: 2dp, HALF_UP by default. Floor price rounds CEILING, retailer max price rounds FLOOR. */
public final class Money {
    private Money() {
    }

    public static BigDecimal bd(Object o) {
        if (o == null) {
            return null;
        }
        if (o instanceof BigDecimal b) {
            return b;
        }
        return new BigDecimal(o.toString());
    }

    public static BigDecimal round2(BigDecimal v) {
        return v == null ? null : v.setScale(2, RoundingMode.HALF_UP);
    }

    public static BigDecimal ceil2(BigDecimal v) {
        return v == null ? null : v.setScale(2, RoundingMode.CEILING);
    }

    public static BigDecimal floor2(BigDecimal v) {
        return v == null ? null : v.setScale(2, RoundingMode.FLOOR);
    }

    public static String str(BigDecimal v) {
        return v == null ? null : v.toPlainString();
    }
}
