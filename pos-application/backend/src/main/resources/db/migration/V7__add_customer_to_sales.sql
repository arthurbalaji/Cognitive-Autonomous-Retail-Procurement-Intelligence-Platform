ALTER TABLE sales
ADD COLUMN customer_id BIGINT;

ALTER TABLE sales
ADD CONSTRAINT fk_sale_customer
FOREIGN KEY (customer_id)
REFERENCES customers(id);