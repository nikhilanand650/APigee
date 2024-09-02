function scheduleQuery() {
    ScriptApp.newTrigger('runQuery')
        .timeBased()
        .everyDays(1)
        .atHour(7) // Run at 7-8 AM
        .create();
}


/**
 * Runs a BigQuery query and logs the results in a spreadsheet.
 */
function runQuery() {
    // GCP Project ID.
    const projectId = 'glbl-apigee-prod'; // Project ID

    const today = new Date();

    const yesterday = new Date(today.getTime() - 12 * 60 * 60 * 1000); //To fetch records since last X (12) hours
   // const yesterday = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000); //To fetch records since last X (7) days

    const formattedToday = Utilities.formatDate(today, 'UTC', 'yyyy-MM-dd HH:mm:ss');
    const formattedYesterday = Utilities.formatDate(yesterday, 'UTC', "yyyy-MM-dd");


    const request = {
        // Big Query
        query: "select  DATE(timestamp) AS Day_UTC, JSON_EXTRACT_SCALAR(json_payload, '$.apiProxyName') apiProxyName,   COUNT(*) AS total_calls,    ROUND(AVG(CAST(JSON_EXTRACT_SCALAR(json_payload, '$.proxyResponseTime') AS FLOAT64)),3) AS avg_APIResponseTime,   MIN(CAST(JSON_EXTRACT_SCALAR(json_payload, '$.proxyResponseTime') AS FLOAT64)) AS min_APIResponseTime,   MAX(CAST(JSON_EXTRACT_SCALAR(json_payload, '$.proxyResponseTime') AS FLOAT64)) AS max_APIResponseTime,     APPROX_QUANTILES(CAST(JSON_EXTRACT_SCALAR(json_payload, '$.proxyResponseTime') AS FLOAT64), 100)[OFFSET(90)] AS p90_MaxAPIResponseTime,   APPROX_QUANTILES(CAST(JSON_EXTRACT_SCALAR(json_payload, '$.proxyResponseTime') AS FLOAT64), 100)[OFFSET(99)] AS p99_MaxAPIResponseTime,    ROUND(AVG(CAST(NULLIF(JSON_EXTRACT_SCALAR(json_payload, '$.targetResponseTime'), '') AS FLOAT64)),3) AS avg_TargetResponseTime,   MIN(CAST(NULLIF(JSON_EXTRACT_SCALAR(json_payload, '$.targetResponseTime'), '') AS FLOAT64)) AS MinTargetResponseTime,   MAX(CAST(NULLIF(JSON_EXTRACT_SCALAR(json_payload, '$.targetResponseTime'), '') AS FLOAT64)) AS max_TargetResponseTime, COUNTIF(CAST(JSON_EXTRACT_SCALAR(json_payload, '$.proxyResponseTime') AS FLOAT64) > 999) AS count_Res_gt_1S,  COUNTIF(JSON_EXTRACT_SCALAR(json_payload, '$.responseFromProxy.statusCode') != '200') AS total_Errors FROM `glbl-apigee-prod.apigee_api_prod_logs._AllLogs` where  JSON_EXTRACT_SCALAR(json_payload, '$.appName') = 'Webseal - TAM' AND timestamp >= TIMESTAMP('" + formattedYesterday + "')  GROUP BY apiProxyName, Day_UTC ORDER BY  Day_UTC,apiProxyName limit 50;",
        useLegacySql: false
    };
    let queryResults = BigQuery.Jobs.query(request, projectId);
    const jobId = queryResults.jobReference.jobId;

    // Check on status of the Query Job.
    let sleepTimeMs = 500;
    while (!queryResults.jobComplete) {
        Utilities.sleep(sleepTimeMs);
        sleepTimeMs *= 2;
        queryResults = BigQuery.Jobs.getQueryResults(projectId, jobId);
    }

    // Get all the rows of results.
    let rows = queryResults.rows;
    while (queryResults.pageToken) {
        queryResults = BigQuery.Jobs.getQueryResults(projectId, jobId, {
            pageToken: queryResults.pageToken
        });
        rows = rows.concat(queryResults.rows);
    }

    if (!rows) {
        console.log('No rows returned.');
        return;
    }

    // Group rows by sheet name.
    const sheetsData = rows.reduce((acc, row) => {
        const cols = row.f.map(col => col.v);
        const sheetName = cols[1];
        cols.push(formattedToday); // Add 'last_updated' value.
        if (!acc[sheetName]) {
            acc[sheetName] = [];
        }
        acc[sheetName].push(cols);
        return acc;
    }, {});

    // Process each sheet separately.
    for (const [sheetName, data] of Object.entries(sheetsData)) {
        const sheet = getSheetOrCreate(sheetName, queryResults);       
        updateSheetWithData(sheet, data);
    }
    console.log('Results spreadsheet updated: %s', SpreadsheetApp.getActiveSpreadsheet().getUrl());
}

function getSheetOrCreate(sheetName, queryResults) {
    let sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
    if (!sheet) {
        //sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
        sheet = SpreadsheetApp.getActiveSpreadsheet().insertSheet(sheetName); //create sheet
        // Append the headers.
        const headers = queryResults.schema.fields.map(function(field) {
            return field.name;
        });
        headers.push('Last_Updated_Date (UTC)');
        sheet.appendRow(headers);

        // Get the range of the headers.
        const headerRange = sheet.getRange(1, 1, 1, headers.length);

        // Set the headers to be bold.
        headerRange.setFontWeight('bold');

        // Set the background color to grey.
        headerRange.setBackground('#d3d3d3'); // Light grey color

        // Auto fit the columns to the header content.
        //sheet.setColumnWidths(1, headers.length, 8);
        sheet.autoResizeColumns(1, headers.length);


    }
    return sheet;
}
//const spreadsheet = SpreadsheetApp.create('BigQuery Results');
//const sheet = spreadsheet.getActiveSheet();

//const sheetName = SpreadsheetApp.getActiveSheet().getName();




//headerRange.setHorizontalAlignment('center');

// Create a map of existing Dates to row numbers .
// const existingData = sheet.getDataRange().getValues();


function updateSheetWithData(sheet, data) {
    // Get the last row number
    const lastRow = sheet.getLastRow();

    // To update only the last 7 days records
    const numRecordsToLoad = 7;

    // Calculate the starting row number
    const startRow = Math.max(lastRow - numRecordsToLoad + 1, 1);

    // Get the data range of the last numRecordsToLoad rows
    const range = sheet.getRange(startRow, 1, numRecordsToLoad, sheet.getLastColumn());
    const existingData = range.getValues();

    const idToRowMap = {};
    for (let i = 0; i < existingData.length; i++) {
        let id = null;
        try {
            id = Utilities.formatDate(existingData[i][0], Session.getScriptTimeZone(), "yyyy-MM-dd");
        } catch (e) {
        }
        idToRowMap[id] = i + startRow;
    }

    data.forEach(rowData => {
        const id = rowData[0];
        if (id in idToRowMap) {
            // Update the existing row.
            const rowNum = idToRowMap[id];
            sheet.getRange(rowNum, 1, 1, rowData.length).setValues([rowData]);
        } else {
            // Append the new row.
            sheet.appendRow(rowData);
        }
    });
}
