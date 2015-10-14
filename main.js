var esprima = require("esprima");
var options = {tokens:true, tolerant: true, loc: true, range: true };
var faker = require("faker");
var fs = require("fs");
faker.locale = "en";
var mock = require('mock-fs');
var _ = require('underscore');
var Random = require('random-js');

function main()
{
	var args = process.argv.slice(2);

	if( args.length == 0 )
	{
		args = ["subject.js"];
	}
	var filePath = args[0];

	constraints(filePath);

	generateTestCases(filePath)

}

var engine = Random.engines.mt19937().autoSeed();

function createConcreteIntegerValue( greaterThan, constraintValue )
{
	if( greaterThan )
		return Random.integer(constraintValue,constraintValue+10)(engine);
	else
		return Random.integer(constraintValue-10,constraintValue)(engine);
}

function Constraint(properties)
{
	this.ident = properties.ident;
	this.expression = properties.expression;
	this.operator = properties.operator;
	this.value = properties.value;
	this.funcName = properties.funcName;
	// Supported kinds: "fileWithContent","fileExists"
	// integer, string, phoneNumber
	this.kind = properties.kind;
}

function fakeDemo()
{
	console.log( faker.phone.phoneNumber() );
	console.log( faker.phone.phoneNumberFormat() );
	console.log( faker.phone.phoneFormats() );
}

var functionConstraints =
{
}

var mockFileLibrary = 
{
	pathExists:
	{
		'path/fileExists': {}
	},
	fileWithContent:
	{
		pathContent: 
		{	
  			file1: 'text content',
  			file2: '',
		}
	}
};

function getArguments(params) {

	var output = "";
	var resultArray = [];
	var keyArray = Object.keys(params);	
	//console.log("Params" + JSON.stringify(params) + "\n");

	recFunc(params, output, 0, resultArray, keyArray);
	//console.log(resultArray)
	return resultArray;
}

function recFunc(outerArray, output, index, resultArray, keyArray) {
	if(index == keyArray.length) {
		resultArray.push(output);
		return;
	}
	var outputCopy = output.slice(0);
	var innerArray = outerArray[keyArray[index]];
	if(innerArray.length == 0) {
		innerArray.push("'" + String(faker.phone.phoneNumber(faker.phone.phoneNumberFormat(0))) + "'");
	}

	for(var i in innerArray) {
		//console.log("Innerarray " + JSON.stringify(innerArray[i]))
		var outputCopy = output.slice(0);
		outputCopy += innerArray[i];
		if(index != keyArray.length - 1) {
			outputCopy += ",";
		}
		recFunc(outerArray, outputCopy, index+1, resultArray, keyArray);
	}

}

function generateTestCases(filePath)
{

	var content = "var subject = require('./" + filePath + "')\nvar mock = require('mock-fs');\n";
	for ( var funcName in functionConstraints )
	{
		var params = {};

		// initialize params
		for (var i =0; i < functionConstraints[funcName].params.length; i++ )
		{
			var paramName = functionConstraints[funcName].params[i];
			//params[paramName] = '\'' + faker.phone.phoneNumber()+'\'';
			params[paramName] = [];
		}

		//console.log( params );

		// update parameter values based on known constraints.
		var constraints = functionConstraints[funcName].constraints;
		// Handle global constraints...
		var fileWithContent = _.some(constraints, {kind: 'fileWithContent' });
		var pathExists      = _.some(constraints, {kind: 'fileExists' });

		// plug-in values for parameters
		for( var c = 0; c < constraints.length; c++ )
		{
			var constraint = constraints[c];
			if(constraint.kind == "NonFunctionParams") {
				var keyArray = Object.keys(params);	
				//console.log("_________________________________________________" + typeof(keyArray[0]));
				for( var p =0; p < keyArray.length; p++ )	{

					if(params[keyArray[p]].length == 0){
						//console.log("_________________________________________________");
						params[keyArray[p]].push(constraint.value);

					}
					if(typeof(keyArray[p]) == "string"){
						//console.log("_________________________________________________0000000");
						params[keyArray[p]].push(constraint.value);

					}
				}
			}

			if( params.hasOwnProperty( constraint.ident ) )
			{
				params[constraint.ident].push(constraint.value);
			}
		}

		// Prepare function arguments.
		//var args = Object.keys(params).map( function(k) {return params[k]; }).join(",");
		var args = getArguments(params);
		//console.log(args)
		if( pathExists || fileWithContent )
		{
			//console.log("-------------------------------------------------------------" + content);
			for(var i in args) {
				content += generateMockFsTestCases(pathExists,fileWithContent,funcName, args[i]);
				// Bonus...generate constraint variations test cases....
				content += generateMockFsTestCases(!pathExists,fileWithContent,funcName, args[i]);
				content += generateMockFsTestCases(pathExists,!fileWithContent,funcName, args[i]);
				content += generateMockFsTestCases(!pathExists,!fileWithContent,funcName, args[i]);
			}
			//console.log("-------------------------------------------------------------" + content);
		}
		else
		{
			// Emit simple test case.
			for(var i in args) {
			content += "subject.{0}({1});\n".format(funcName, args[i] );
			}
			//console.log("-------------------------------------------------------------" + content);
			if(args.length == 0) {
				var tempString = "\'\'";
				args = Object.keys(params).map( function(k) {return tempString}).join(",");
				content += "subject.{0}({1});\n".format(funcName, args );

			}
		}

	}


	fs.writeFileSync('test.js', content, "utf8");

}

function generateMockFsTestCases (pathExists,fileWithContent,funcName,args) 
{
	var testCase = "";
	// Build mock file system based on constraints.
	var mergedFS = {};
	if( pathExists )
	{
		for (var attrname in mockFileLibrary.pathExists) { mergedFS[attrname] = mockFileLibrary.pathExists[attrname]; }
	}
	if( fileWithContent )
	{
		for (var attrname in mockFileLibrary.fileWithContent) { mergedFS[attrname] = mockFileLibrary.fileWithContent[attrname]; }
	}

	testCase += 
	"mock(" +
		JSON.stringify(mergedFS)
		+
	");\n";

	testCase += "\tsubject.{0}({1});\n".format(funcName, args );
	testCase+="mock.restore();\n";
	return testCase;
}

function constraints(filePath)
{
   var buf = fs.readFileSync(filePath, "utf8");
	var result = esprima.parse(buf, options);


	traverse(result, function (node) 
	{
		var expression;
		if (node.type === 'FunctionDeclaration') 
		{
			var funcName = functionName(node);
			//console.log("Line : {0} Function: {1}".format(node.loc.start.line, funcName ));

			var params = node.params.map(function(p) {return p.name});

			functionConstraints[funcName] = {constraints:[], params: params};

			// Check for expressions using argument.
			traverse(node, function(child)
			{

				if( child.type === 'BinaryExpression') {
					getBinaryConstraints(params, child, buf, funcName, functionConstraints);
				}
				

				if( child.type == "CallExpression" && 
					 child.callee.property &&
					 child.callee.property.name =="readFileSync" )
				{
					for( var p =0; p < params.length; p++ )
					{
						if( child.arguments[0].name == params[p] )
						{
							functionConstraints[funcName].constraints.push( 
							new Constraint(
							{
								ident: params[p],
								value:  "'pathContent/file1'",
								funcName: funcName,
								kind: "fileWithContent",
								operator : child.operator,
								expression: expression
							}));
							functionConstraints[funcName].constraints.push( 
							new Constraint(
							{
								ident: params[p],
								value:  "'pathContent/file2'",
								funcName: funcName,
								kind: "fileWithContent",
								operator : child.operator,
								expression: expression
							}));
							functionConstraints[funcName].constraints.push( 
							new Constraint(
							{
								ident: params[p],
								value:  "'pathContent/NoFile'",
								funcName: funcName,
								kind: "fileWithContent",
								operator : child.operator,
								expression: expression
							}));

						}
					}
				}

				if( child.type == "CallExpression" &&
					 child.callee.property &&
					 child.callee.property.name =="existsSync")
				{
					for( var p =0; p < params.length; p++ )
					{
						if( child.arguments[0].name == params[p] )
						{
							functionConstraints[funcName].constraints.push( 
							new Constraint(
							{
								ident: params[0],
								// A fake path to a file
								value:  "'path/fileExists'",
								funcName: funcName,
								kind: "fileExists",
								operator : child.operator,
								expression: expression
							}));
							functionConstraints[funcName].constraints.push( 
							new Constraint(
							{
								ident: params[0],
								// A fake path to a file
								value:  "'pathContent'",
								funcName: funcName,
								kind: "fileExists",
								operator : child.operator,
								expression: expression
							}));
							functionConstraints[funcName].constraints.push( 
							new Constraint(
							{
								ident: params[0],
								// A fake path to a file
								value:  "'NullDir'",
								funcName: funcName,
								kind: "fileExists",
								operator : child.operator,
								expression: expression
							}));
						}
					}
				}

				if(child.type == "UnaryExpression"  && child.argument && child.argument.property && child.argument.property.type == "Identifier") {
					propertyName = child.argument.property.name;
					var nullOptions = {};
					var normOptions = {};
					normOptions[propertyName] = true;
					var normOptionsFalse = {};
					normOptionsFalse[propertyName] = false;

					functionConstraints[funcName].constraints.push( 
					new Constraint(
					{
						ident: child.argument.object.name,
						// A fake path to a file
						value:  JSON.stringify(nullOptions),
						funcName: funcName,
						kind: "Identifier",
						operator : child.operator,
						expression: expression
					}));
					functionConstraints[funcName].constraints.push( 
					new Constraint(
					{
						ident: child.argument.object.name,
						// A fake path to a file
						value:  JSON.stringify(normOptions),
						funcName: funcName,
						kind: "Identifier",
						operator : child.operator,
						expression: expression
					}));
					functionConstraints[funcName].constraints.push( 
					new Constraint(
					{
						ident: child.argument.object.name,
						// A fake path to a file
						value:  JSON.stringify(normOptionsFalse),
						funcName: funcName,
						kind: "Identifier",
						operator : child.operator,
						expression: expression
					}));					
				}

			});

			//console.log( functionConstraints[funcName]);

		}
	});
}

function getBinaryConstraints(params, child, buf, funcName, functionConstraints) {
	var randomString = "\"asdf\"";
	if( child.left.type == 'Identifier' && params.indexOf( child.left.name ) > -1)
		{
			// get expression from original source code:
			var expression = buf.substring(child.range[0], child.range[1]);
			var rightHand = buf.substring(child.right.range[0], child.right.range[1]);
			kind = typeof(rightHand);
			

			if(! isNaN(rightHand)) {
				kind = "integer"
				if(child.operator == "==") {
					functionConstraints[funcName].constraints.push( makeConstraint(child.left.name, parseFloat(rightHand), funcName, kind, child.operator, expression));
					functionConstraints[funcName].constraints.push( makeConstraint(child.left.name, parseFloat(rightHand)+1, funcName, kind, child.operator, expression));
				}
				else  if(child.operator == "!="){
					functionConstraints[funcName].constraints.push( makeConstraint(child.left.name, parseFloat(rightHand), funcName, kind, child.operator, expression));
					functionConstraints[funcName].constraints.push( makeConstraint(child.left.name, parseFloat(rightHand)+1, funcName, kind, child.operator, expression));
				}
				else  if(child.operator == "<"){
					functionConstraints[funcName].constraints.push( makeConstraint(child.left.name, parseFloat(rightHand), funcName, kind, child.operator, expression));
					functionConstraints[funcName].constraints.push( makeConstraint(child.left.name, parseFloat(rightHand)-1, funcName, kind, child.operator, expression));
				}
				else  if(child.operator == ">"){
					functionConstraints[funcName].constraints.push( makeConstraint(child.left.name, parseFloat(rightHand), funcName, kind, child.operator, expression));
					functionConstraints[funcName].constraints.push( makeConstraint(child.left.name, parseFloat(rightHand)+1, funcName, kind, child.operator, expression));
				}
				else  if(child.operator == "<="){
					functionConstraints[funcName].constraints.push( makeConstraint(child.left.name, parseFloat(rightHand), funcName, kind, child.operator, expression));
					functionConstraints[funcName].constraints.push( makeConstraint(child.left.name, parseFloat(rightHand)+1, funcName, kind, child.operator, expression));
				}
				else  if(child.operator == ">="){
					functionConstraints[funcName].constraints.push( makeConstraint(child.left.name, parseFloat(rightHand), funcName, kind, child.operator, expression));
					functionConstraints[funcName].constraints.push( makeConstraint(child.left.name, parseFloat(rightHand)-1, funcName, kind, child.operator, expression));
				}

			}
			else if(rightHand == "undefined") {
				functionConstraints[funcName].constraints.push( makeConstraint(child.left.name, rightHand, funcName, kind, child.operator, expression));
				functionConstraints[funcName].constraints.push( makeConstraint(child.left.name, 5, funcName, kind, child.operator, expression));
			}
			else if(typeof(rightHand) == "string") {
				if(child.operator == "==") {
					functionConstraints[funcName].constraints.push( makeConstraint(child.left.name, rightHand, funcName, kind, child.operator, expression));
					functionConstraints[funcName].constraints.push( makeConstraint(child.left.name, randomString, funcName, kind, child.operator, expression));	

				}
				else  if(child.operator == "!="){
					functionConstraints[funcName].constraints.push( makeConstraint(child.left.name, rightHand, funcName, kind, child.operator, expression));
					functionConstraints[funcName].constraints.push( makeConstraint(child.left.name, randomString, funcName, kind, child.operator, expression));	

				}

			}
			
		}
		else if(child.left.type == 'CallExpression') {
			//console.log("----- " + rightHand);
			//kind = typeof
			var leftChild = child.left;
			if(leftChild.callee && leftChild.callee.property.name == "indexOf") {
				var callString = "\"" +  leftChild.arguments[0].value + "\"";
				functionConstraints[funcName].constraints.push( makeConstraint(leftChild.callee.object.name, callString, funcName, kind, child.operator, expression));
				functionConstraints[funcName].constraints.push( makeConstraint(leftChild.callee.object.name, randomString, funcName, kind, child.operator, expression));	

			}
		}
		else if(child.left.type == 'Identifier' && child.operator == "==") {
			var expression = buf.substring(child.range[0], child.range[1]);
			var rightHand = buf.substring(child.right.range[0], child.right.range[1]);
			
			var temp = '-000-0000';
			var res = rightHand.substring(1,4)
			//console.log(res + temp);
			var fin = res + temp;
			var res1 = "abc";
			var fin2 = res1 + temp;

			var pNum = fin;
			//var pNum = faker.phone.phoneNumber(faker.phone.phoneNumberFormat(0));
			var pNum2 = fin2;
			//pNum = pNum.replace(pNum.substring(1,3), rightHand);
			//pNum2 = pNum2.replace(pNum2.substring(0,2), "abc");
				
				functionConstraints[funcName].constraints.push( 
					new Constraint(
					{
						ident: child.left.name,
						// A fake path to a file
						value:  "'" + pNum + "'",
						funcName: funcName,
						kind: "NonFunctionParams",
						operator : child.operator,
						expression: expression
					}));
				functionConstraints[funcName].constraints.push( 
					new Constraint(
					{
						ident: child.left.name,
						// A fake path to a file
						value:  "'" + pNum2 + "'",
						funcName: funcName,
						kind: "NonFunctionParams",
						operator : child.operator,
						expression: expression
					}));
	
		}
}

function makeConstraint(name, value,funcName, kind, operator, expression) {
	return new Constraint(
		{
			ident: name,
			value: value,
			funcName: funcName,
			kind: kind,
			operator : operator,
			expression: expression
		});
}

function traverse(object, visitor) 
{
    var key, child;

    visitor.call(null, object);
    for (key in object) {
        if (object.hasOwnProperty(key)) {
            child = object[key];
            if (typeof child === 'object' && child !== null) {
                traverse(child, visitor);
            }
        }
    }
}

function traverseWithCancel(object, visitor)
{
    var key, child;

    if( visitor.call(null, object) )
    {
	    for (key in object) {
	        if (object.hasOwnProperty(key)) {
	            child = object[key];
	            if (typeof child === 'object' && child !== null) {
	                traverseWithCancel(child, visitor);
	            }
	        }
	    }
 	 }
}

function functionName( node )
{
	if( node.id )
	{
		return node.id.name;
	}
	return "";
}


if (!String.prototype.format) {
  String.prototype.format = function() {
    var args = arguments;
    return this.replace(/{(\d+)}/g, function(match, number) { 
      return typeof args[number] != 'undefined'
        ? args[number]
        : match
      ;
    });
  };
}

main();
