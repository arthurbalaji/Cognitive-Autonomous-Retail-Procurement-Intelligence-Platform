CREATE TABLE customers (
    id BIGSERIAL PRIMARY KEY,
    company_name VARCHAR(200) NOT NULL,
    contact_person VARCHAR(150),
    email VARCHAR(150),
    phone VARCHAR(20),
    address VARCHAR(500),
    gst_number VARCHAR(20),
    credit_limit DECIMAL(12,2) DEFAULT 0,
    outstanding_balance DECIMAL(12,2) DEFAULT 0,
    active BOOLEAN NOT NULL DEFAULT TRUE
);

INSERT INTO customers (company_name, contact_person, email, phone, address, gst_number, credit_limit) VALUES
    ('Metro Engineering Works', 'Rajesh Kumar', 'rajesh@metroeng.com', '9876543210', '42 Industrial Area Phase-II, Chandigarh', '07AABCM1234F1ZP', 500000.00),
    ('Apex Manufacturing Ltd', 'Priya Sharma', 'priya@apexmfg.com', '9876543211', '15 MIDC Bhosari, Pune', '27AABCA5678G2ZQ', 750000.00),
    ('Global Fabricators', 'Vikram Singh', 'vikram@globalfab.in', '9876543212', '8 Okhla Industrial Estate, Delhi', '07AABCG9012H3ZR', 300000.00),
    ('SunTech Industries', 'Anita Patel', 'anita@suntech.co.in', '9876543213', '22 GIDC Naroda, Ahmedabad', '24AABCS3456I4ZS', 600000.00),
    ('Precision Tools India', 'Manoj Gupta', 'manoj@precisiontools.in', '9876543214', '5 Peenya Industrial Area, Bangalore', '29AABCP7890J5ZT', 400000.00);
